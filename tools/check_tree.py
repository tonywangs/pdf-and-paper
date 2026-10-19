#!/usr/bin/env python3
"""Check publication size/file constraints without inspecting credentials or remotes."""
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
paths=sorted(set(p for p in paths if p))
assert len(paths)<=1000, f'{len(paths)} files exceeds 1000'
total=0
for name in paths:
    path=root/name
    assert not path.is_symlink(), f'Symlink not allowed: {name}'
    assert name not in ('.agents','.codex') and not name.startswith(('.agents/','.codex/')), name
    assert not name.endswith('.log') or name=='results/tests.log', name
    size=path.stat().st_size
    assert size<=10*1024*1024, f'{name} exceeds 10 MiB'
    total+=size
assert total<=32*1024*1024, f'Tree exceeds 32 MiB: {total}'
print(f'PASS publication tree: {len(paths)} files, {total} bytes; per-file, tree, count and log constraints satisfied.')
