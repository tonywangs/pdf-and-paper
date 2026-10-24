#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules/markdown-it ]; then
  npm ci --cache "${TMPDIR:-/tmp}/epub-assembly-npm" --no-audit --no-fund
fi
exec node src/server.mjs
