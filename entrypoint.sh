#!/usr/bin/env bash

set -e  # Exit immediately if a command exits with a non-zero status.

NODE="node"
APP="tcpserver.js"
BASE_APP_ARGS="--host=$HOST --port=$PORT"

if [ "${1:0:1}" = '-' ]; then
  set -- "$APP" "$@" "$BASE_APP_ARGS"
fi

if [ "${1}" = "$APP" ]; then
  set -- "$NODE" "$@"
fi

exec ${@}
