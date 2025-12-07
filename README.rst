.. image:: https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner-direct-single.svg
 :target: https://stand-with-ukraine.pp.ua
 :alt: Stand With Ukraine

|

MJML TCP-Server
===============

A `MJML <https://mjml.io/>`_ Server over TCP protocol.

Mainly created for `django-mjml <https://github.com/liminspace/django-mjml>`_.

|

Using directly
--------------

You can run the server just running the file with arguments like::

  $ node tcpserver.js --host=0.0.0.0 --port=28101 --mjml.minify=true --mjml.validationLevel=strict


Using Docker
------------

Build the image::

  $ docker build -t mjml-tcpserver .

You can specify build arguments::

  $ docker build -t mjml-tcpserver \
    --build-arg MJML_VERSION=4.17.2 \
    --build-arg EXPOSE=28101 \
    --no-cache .

Look at the Dockerfile to see the default values of arguments.

Then run a docker container::

  $ docker run -d --rm -p 28101:28101 mjml-tcpserver

You can set host and port of the server using env vars::

  $ docker run -d --rm -p 28105:28105 -e HOST=127.0.0.1 -e PORT=28105 mjml-tcpserver

To set mjml options pass arguments as cmd using `mjml.` prefix::

  $ docker run -d --rm -p 28101:28101 mjml-tcpserver --mjml.minify=true --mjml.validationLevel=strict

All MJML arguments are listed `here <https://documentation.mjml.io/#inside-node-js>`_.


Stop the server on touch a file
-------------------------------

If you wish the server to be stopped when a file is touched, use `--touchstop=/tmp/mjmltcpserver.stop`.

Be sure the file exists. In case with Docker you can mount that file using a volume.


Daemonize the server using supervisor
-------------------------------------

Example of configuration file::

  /etc/supervisor/conf.d/mjmltcpserver.conf

  [program:mjmltcpserver]
  user=user
  environment=NODE_PATH=/home/user/node_modules
  command=node
      /home/user/mjml-tcpserver/tcpserver.js
      --port=28101 --host=127.0.0.1 --touchstop=/tmp/mjmltcpserver.stop --mjml.minify=true --mjml.validationLevel=strict
  stdout_logfile=/var/log/supervisor/mjmltcpserver.log
  autostart=true
  autorestart=true
  redirect_stderr=true
  stopwaitsecs=10
  stopsignal=INT


Docker compose
--------------

Example::

  services:
    mjml-1:
      image: liminspace/mjml-tcpserver:1
      restart: always
      ports:
        - "28101:28101"

    mjml-2:
      image: liminspace/mjml-tcpserver:1
      restart: always
      environment:
        HOST: "0.0.0.0"
        PORT: "28102"
      expose:
        - "28102"
      ports:
        - "28102:28102"
      command: ["--mjml.minify=true", "--mjml.validationLevel=strict"]

    mjml-3:
      build:
        context: .
        args:
          - MJML_VERSION=4.17.2
          - EXPOSE=28103
      restart: always
      ports:
        - "28103:28103"
