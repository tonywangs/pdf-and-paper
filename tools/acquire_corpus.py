#!/usr/bin/env python3
"""Reacquire the frozen, licensed corpus. Never follows a moving branch."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1] / 'web' / 'corpus'
manifest = json.loads((ROOT / 'manifest.json').read_text())
for entry in manifest['files']:
    expected = f"https://raw.githubusercontent.com/rust-lang/book/{manifest['revision']}/{entry['path']}"
    assert entry['url'] == expected
    with urlopen(expected, timeout=30) as response:
        data = response.read()
    assert len(data) == entry['bytes'], entry['name']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['name']
    (ROOT / entry['name']).write_bytes(data)
print(f"Reacquired and verified {len(manifest['files'])} pinned files")
