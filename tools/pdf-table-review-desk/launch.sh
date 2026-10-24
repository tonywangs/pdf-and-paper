#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ] || ! .venv/bin/python -c 'import flask, pdfplumber, pypdfium2, pypdf' 2>/dev/null; then
  python3 -m venv .venv || { echo 'Install Python 3.10+ with its venv package, then rerun ./launch.sh'; exit 1; }
  .venv/bin/python -m pip install -r requirements.txt
fi
exec .venv/bin/python app.py
