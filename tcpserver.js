'use strict';

const mjmlModule = require('mjml'),
    mjml = mjmlModule.default || mjmlModule,
    mjml_maj_ver = parseInt(require('mjml/package.json').version.split('.')[0], 10),
    max_request_body_size = 50 * 1024 * 1024,
    max_response_body_size = 25 * 1024 * 1024,
    msg_header_size = 9,
    force_close_delay = 5 * 1000,
    net = require('net'),
    fs = require('fs'),
    argv = process.argv.slice(2),
    conf = {
        host: '127.0.0.1',
        port: 28101,
        maxconnections: 1000,
        touchstop: null,
        verbose: false,
        mjml: {
            validationLevel: 'strict'
        }
    },
    connections = new Set();

if (mjml_maj_ver < 4) {
    throw new Error(`Unsupported MJML version ${mjml_maj_ver}, use version 4 or higher`);
}

if (typeof mjml !== 'function') {
    throw new TypeError('Unsupported MJML module format');
}

let server = null,
    terminating = false;

function terminate(exit_code) {
    if (terminating) {
        return;
    }
    terminating = true;

    // do not hang forever if server.close() is waiting for a stuck connection
    const force_exit_timer = setTimeout(function () {
        process.exit(exit_code);
    }, force_close_delay);
    force_exit_timer.unref();

    for (const conn of connections) {
        conn.destroy();
    }
    if (server && server.listening) {
        server.close(function () {
            process.exit(exit_code);
        });
    } else {
        process.exit(exit_code);
    }
}

process.on('SIGINT', function () {
    terminate(0);
});

process.on('SIGTERM', function () {
    terminate(0);
});

process.on('uncaughtException', function (err) {
    console.error('Uncaught exception:', (err && err.stack) || err);
    terminate(1);
});

process.on('unhandledRejection', function (reason) {
    console.error('Unhandled rejection:', (reason && reason.stack) || reason);
    terminate(1);
});

for (let i = 0; i < argv.length; i++) {
    let eq, key, val, subkey,
        arg = argv[i];
    try {
        if (!arg.startsWith('--')) {
            throw new Error('unknown arg');
        } else {
            arg = arg.slice(2);
        }
        if (arg === 'help') {
            // more options: https://github.com/mjmlio/mjml/blob/v4.18.0/packages/mjml-core/src/index.js#L100
            console.log('Run command: NODE_PATH=node_modules node tcpserver.js ' +
                '--port=28101 --host=127.0.0.1 --maxconnections=1000 --touchstop=/tmp/mjmltcpserver.stop ' +
                '--mjml.minify=false --mjml.validationLevel=soft');
            terminate(0);
        }
        // split on the first "=" only, so values may contain "=" themselves
        eq = arg.indexOf('=');
        if (eq < 1) {
            throw new Error('wrong syntax');
        }
        key = arg.slice(0, eq);
        val = arg.slice(eq + 1);
        if (Object.prototype.hasOwnProperty.call(conf, key) && key !== 'mjml') {
            if (key === 'port' || key === 'maxconnections') {
                val = Number(val);
                if (!Number.isInteger(val) || val < 1 || (key === 'port' && val > 65535)) {
                    throw new Error(`Invalid ${key}: ${val}`);
                }
            } else if (key === 'verbose') {
                val = (new Set(['true', 'yes', '1', 'on']).has(val.toLowerCase()));
            } else if ((key === 'host' || key === 'touchstop') && val === '') {
                throw new Error(`Invalid ${key}: value cannot be empty`);
            }
            conf[key] = val;
        } else if (key.startsWith('mjml.')) {
            subkey = key.slice(5);
            if (subkey === '') {
                throw new Error('MJML option name cannot be empty');
            }
            if (val === 'true') {
                val = true;
            } else if (val === 'false') {
                val = false;
            }
            conf.mjml[subkey] = val;
        } else {
            throw new Error('unknown arg');
        }
    } catch (err) {
        console.error('Invalid parsing arg "%s": %s', argv[i], err.message);
        terminate(1);
    }
}

// reads the first `size` bytes out of the pending chunks without merging them;
// safe to cut a chunk at any offset because ascii is single-byte
function peekAscii(chunks, size) {
    let out = '',
        got = 0;
    for (const chunk of chunks) {
        const take = Math.min(size - got, chunk.length);
        out += chunk.toString('ascii', 0, take);
        got += take;
        if (got >= size) {
            break;
        }
    }
    return out;
}

function sendResponse(conn, result, isError = false, end = false) {
    if (conn.destroyed || !conn.writable) {
        return;
    }

    const body = String(result),
        length = Buffer.byteLength(body, 'utf8');

    if (length > max_response_body_size) {
        sendResponse(conn, 'Response payload is too large', true, true);
        return;
    }

    const status = isError ? '1' : '0',
        response = status + (Array(msg_header_size + 1).join('0') + length.toString()).slice(-msg_header_size) + body;

    if (conf.verbose) {
        console.log('Response', length, (isError ? 'ERR' : 'OK'));
    }
    if (end) {
        conn.end(response);
    } else {
        conn.write(response);
    }
}

function handleConnection(conn) {
    connections.add(conn);
    conn.on('close', function () {
        connections.delete(conn);
    });

    let chunks = [],
        buffered = 0,
        closing = false,
        processing = false,
        processAgain = false,
        header, payload_size, message_size, merged, rest, mjml_input, result;

    const socket_timeout = 90 * 1000,
        max_buffer_size = max_request_body_size + msg_header_size;

    function resetBuffer() {
        chunks = [];
        buffered = 0;
    }

    // sends a final error and makes sure the socket is really gone: end() alone
    // only half-closes, so a dead peer would hold the fd and its buffer forever
    function closeConnection(message) {
        if (closing) {
            return;
        }
        closing = true;
        resetBuffer();
        sendResponse(conn, message, true, true);

        const force_close_timer = setTimeout(function () {
            conn.destroy();
        }, force_close_delay);
        force_close_timer.unref();
        conn.once('close', function () {
            clearTimeout(force_close_timer);
        });
    }

    conn.setTimeout(socket_timeout, function () {
        closeConnection('Connection timeout');
    });

    async function processBuffer() {
        if (processing) {
            processAgain = true;
            return;
        }
        processing = true;

        try {
            do {
                processAgain = false;
                while (buffered >= msg_header_size && !conn.destroyed && !closing) {
                    header = peekAscii(chunks, msg_header_size);
                    if (!/^\d{9}$/.test(header)) {
                        closeConnection('Invalid request header');
                        return;
                    }

                    payload_size = Number(header);
                    if (payload_size > max_request_body_size) {
                        closeConnection('Request payload is too large');
                        return;
                    }

                    message_size = msg_header_size + payload_size;
                    if (buffered < message_size) {
                        return;  // nothing is copied while the message is still streaming in
                    }

                    merged = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
                    mjml_input = merged.subarray(msg_header_size, message_size).toString('utf8');
                    rest = merged.subarray(message_size);
                    chunks = rest.length ? [rest] : [];
                    buffered = rest.length;
                    merged = undefined;
                    rest = undefined;

                    try {
                        if (conf.verbose) {
                            console.log('Render', payload_size);
                        }
                        result = await mjml(mjml_input, conf.mjml);
                        if (result && typeof result === 'object') {
                            if (Array.isArray(result.errors) && result.errors.length) {
                                if (conf.mjml.validationLevel === 'strict') {
                                    throw new Error(JSON.stringify({'errors': result.errors}, null, 2));
                                } else {
                                    console.warn('MJML error:', result.errors);
                                }
                            }
                            if (typeof result.html !== 'string') {
                                throw new Error('MJML did not return HTML');
                            }
                            result = result.html;
                        } else if (typeof result !== 'string') {
                            throw new Error('MJML returned unsupported result');
                        }
                        sendResponse(conn, result);
                    } catch (err) {
                        sendResponse(conn, err.message, true, false);
                    } finally {
                        mjml_input = undefined;
                        result = undefined;
                    }
                }
            } while (processAgain && buffered >= msg_header_size && !conn.destroyed && !closing);
        } finally {
            processing = false;
        }
    }

    conn.on('data', function (chunk) {
        if (conf.verbose) {
            console.log('Receive', chunk.length);
        }

        if (closing) {
            return;
        }

        if (buffered + chunk.length > max_buffer_size) {
            closeConnection('Request payload is too large');
            return;
        }

        chunks.push(chunk);
        buffered += chunk.length;

        processBuffer().catch(function (err) {
            console.error('Processing error:', err.message);
            if (!conn.destroyed) {
                closeConnection('Internal server error');
            }
        });

    });
    conn.on('error', function (err) {
        console.error('Connection error:', err.message);
    });
}

server = net.createServer();
server.maxConnections = conf.maxconnections;
server.on('connection', handleConnection);
server.on('error', function (err) {
    console.error('Server error:', err.message);
    terminate(1);
});
server.listen(conf.port, conf.host, function () {
    console.log('RUN SERVER %s:%s', conf.host, conf.port);
});

if (conf.touchstop) {
    try {
        fs.statSync(conf.touchstop);
    } catch (e) {
        fs.closeSync(fs.openSync(conf.touchstop, 'w'));
    }

    fs.watchFile(conf.touchstop, function () {
        console.log('STOP SERVER (cause touchstop)');
        terminate(0);
    });
}
