#!/usr/bin/env python3
"""Independent oracle: character-category scanner; no application token/search code.
Compare every occurrence, complete document set, hash, passage and UTF-16 column.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def lex(text):
    result, start = [], None
    for i, char in enumerate(text + ' '):
        word = unicodedata.category(char)[0] in 'LMN'
        if word and start is None:
            start = i
        if not word and start is not None:
            result.append((unicodedata.normalize('NFC', text[start:i]).lower(), start, i))
            start = None
    return result

def column(text, index):
    return len(text[:index].encode('utf-16-le')) // 2 + 1

def reference(text, query, mode):
    wanted = [t[0] for t in lex(query)]
    matches = []
    for number, line in enumerate(re.split(r'\r\n|\r|\n', text), 1):
        spans = []
        if mode == 'literal':
            spans = [(i, i + len(query)) for i in range(len(line)) if line.startswith(query, i)]
        else:
            words = lex(line)
            for i in range(len(words) - len(wanted) + 1):
                window = words[i:i+len(wanted)]
                if [w[0] for w in window] == wanted:
                    spans.append((window[0][1], window[-1][2]))
        for start, end in spans:
            matches.append(dict(line=number, column=column(line, start), endColumn=column(line, end), passage=line, match=line[start:end]))
    return matches

def main():
    m = json.loads((ROOT/'web/corpus/manifest.json').read_text())
    documents = {}
    for f in m['files']:
        raw = (ROOT/'web/corpus'/f['name']).read_bytes()
        assert len(raw) == f['bytes']
        assert hashlib.sha256(raw).hexdigest() == f['sha256']
        assert f['url'] == f"https://raw.githubusercontent.com/rust-lang/book/{m['revision']}/{f['path']}"
        if f['kind'] == 'document':
            assert len(raw) > 7000, 'Each document is substantive'
            documents[f['name']] = (raw.decode('utf-8'), f['sha256'])
    assert len(documents) >= 20
    queries = json.loads((ROOT/'tests/queries.json').read_text())
    reports = json.loads(subprocess.check_output(['node', 'tools/corpus_reports.mjs'], cwd=ROOT))
    checked = 0
    for q, report in zip(queries, reports, strict=True):
        expected, names = [], []
        for name, (text, digest) in sorted(documents.items()):
            if q.get('file') and name != q['file']:
                continue
            matches = reference(text, q['query'], q['mode'])
            if matches:
                names.append(name)
            expected.extend(dict(r, name=name, hash=digest) for r in matches)
        assert report['coverage'] == dict(submitted=20,indexed=20,rejected=0,failed=0)
        actual_manifest = {f['name']: f['hash'] for f in report['manifest']}
        assert actual_manifest == {name: doc[1] for name, doc in documents.items()}
        assert report['matchingDocuments'] == names, q
        assert report['total'] == len(expected), q
        assert report['truncated'] == (len(expected)>2000)
        actual = [{k:v for k,v in r.items() if k != 'id'} for r in report['results']]
        assert actual == expected[:2000], q
        checked += len(actual)
        print(f"PASS {q['mode']:7} {q['query']!r}: {len(expected)} occurrences / {len(names)} documents")
    sample=json.loads((ROOT/'examples/ownership.json').read_text())
    assert sample == reports[0], 'Regenerate examples when semantics or corpus change'
    print(f'PASS independent reference: {len(queries)} frozen queries, {checked} exact locations; all 20 source hashes and coverage verified.')

if __name__ == '__main__':
    main()
