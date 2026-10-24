"""Check the publishable working tree against this project's size/file limits."""
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
paths=sorted(set(x for x in paths if x and (root/x).exists()))
assert len(paths)<=1000
size=0
for name in paths:
    path=root/name
    assert not path.is_symlink(),f'Symlink needs explicit review: {name}'
    length=path.stat().st_size
    assert length<=10*1024*1024,f'File exceeds 10 MiB: {name}'
    assert not name.endswith('.log') or name=='results/tests.log',f'Unexpected log: {name}'
    size+=length
assert size<=32*1024*1024
print(f'{len(paths)} publishable files; {size} bytes; all within limits')
