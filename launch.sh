#!/bin/sh
set -eu
cd "$(dirname "$0")"
npm ci --omit=dev
exec npm start
