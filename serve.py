#!/usr/bin/env python3
"""Serve only bundled public app assets, on loopback. No uploads or API."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent / 'web'), **kwargs)
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    print(f'Open http://127.0.0.1:{args.port} — Ctrl+C to stop', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
