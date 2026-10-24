"""Run the pinned official EPUBCheck release; keep tools outside the repository.
Requires Java 17+. Set JAVA to a Java executable if it is not on PATH.
"""
import hashlib,os,shutil,subprocess,sys,tempfile,urllib.request,zipfile
from pathlib import Path
cache=Path(tempfile.gettempdir())/'epub-assembly-checker'
jar=cache/'epubcheck-5.3.0/epubcheck.jar'
java=os.environ.get('JAVA') or shutil.which('java')
if not java:raise SystemExit('Java 17+ required. Install a JRE separately or set JAVA=/path/to/java. No check was run.')
if not jar.exists():
 cache.mkdir(exist_ok=True)
 url='https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip'
 with urllib.request.urlopen(url,timeout=60) as response: data=response.read(40*1024*1024)
 assert hashlib.sha256(data).hexdigest()=='6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5','EPUBCheck archive hash mismatch'
 archive=cache/'epubcheck.zip';archive.write_bytes(data)
 with zipfile.ZipFile(archive) as z:z.extractall(cache)
book=sys.argv[1] if len(sys.argv)>1 else 'demo/alice.epub'
report=sys.argv[2] if len(sys.argv)>2 else 'results/epubcheck.json'
raise SystemExit(subprocess.run([java,'-XX:ActiveProcessorCount=2','-jar',str(jar),book,'--json',report]).returncode)
