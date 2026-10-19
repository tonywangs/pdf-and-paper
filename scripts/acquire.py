"""Reacquire exact publicly archived fixtures. Refuse changed bytes."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

def main():
    for doc in json.loads((ROOT/'fixtures/sources.json').read_text())['documents']:
        data=urllib.request.urlopen(doc['download_url'],timeout=30).read(10*1024*1024+1)
        assert hashlib.sha256(data).hexdigest()==doc['sha256'],f"Hash mismatch: {doc['file']}"
        (ROOT/'fixtures'/doc['file']).write_bytes(data)
        print(doc['file'],len(data),doc['sha256'])

if __name__=='__main__':main()
