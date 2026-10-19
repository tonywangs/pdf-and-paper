#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -f node_modules/pdfjs-dist/build/pdf.mjs ]; then
 npm ci --omit=dev --cache "${TMPDIR:-/tmp}/pdf-revision-npm" --no-audit --no-fund
fi
exec node server.mjs
