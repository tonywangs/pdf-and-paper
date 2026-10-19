"""Reproduce both real-input outputs without network access after installation."""
from pathlib import Path
import hashlib
import tempfile
from booklet_fold.core import convert
from verify import verify

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'demo/sets.pdf'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='cd57aa078b8a862ed4b69e489d66b76996212ca2afadd8b326b70dc8b8d321c2'
(ROOT/'build').mkdir(exist_ok=True)
run=Path(tempfile.mkdtemp(prefix='demo-',dir=ROOT/'build'))
for paper in ('a4','letter'):
    directory=run/paper
    convert(source,directory,paper=paper,signature=8,margin_mm=8)
    (directory/'ATTRIBUTION.md').write_text((ROOT/'demo/PROVENANCE.md').read_text())
    verify(source,directory)
    print('Preview:',(directory/'index.html').as_uri())
print('Outputs:',run)
