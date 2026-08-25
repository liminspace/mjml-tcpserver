#!/usr/bin/env bash

set -e  # Exit immediately if a command exits with a non-zero status.

NODE="node"
APP="tcpserver.js"

if [ "${1:0:1}" = '-' ]; then
  set -- "$APP" "$@" "--host=$HOST" "--port=$PORT"
fi

if [ "${1}" = "$APP" ]; then
  set -- "$NODE" "$@"
fi

exec "$@"
