"""Independent ZIP/XML oracle; no application imports or Markdown renderer."""
import hashlib,json,re,sys,zipfile,posixpath
from pathlib import Path
from urllib.parse import unquote,urlsplit
from xml.etree import ElementTree as ET
book=Path(sys.argv[1] if len(sys.argv)>1 else 'demo/alice.epub')
project=json.loads(Path(sys.argv[2] if len(sys.argv)>2 else 'demo/alice.project.json').read_text())
provenance=json.loads(Path('demo/provenance.json').read_text())
ns={'o':'http://www.idpf.org/2007/opf','x':'http://www.w3.org/1999/xhtml','d':'http://purl.org/dc/elements/1.1/'}
norm=lambda s:re.sub(r'\s+',' ',s).strip()
with zipfile.ZipFile(book) as z:
 assert z.infolist()[0].filename=='mimetype' and z.infolist()[0].compress_type==0
 assert z.read('mimetype')==b'application/epub+zip'
 assert len(z.namelist())==len(set(z.namelist()))
 container=ET.fromstring(z.read('META-INF/container.xml'))
 opf=container.find('.//{*}rootfile').attrib['full-path']; root=ET.fromstring(z.read(opf)); base=posixpath.dirname(opf)
 items={e.attrib['id']:e.attrib for e in root.findall('o:manifest/o:item',ns)}
 for field,tag in [('title','title'),('author','creator'),('language','language')]:assert root.find('o:metadata/d:'+tag,ns).text==project['metadata'][field]
 spine=[items[e.attrib['idref']]['href'] for e in root.findall('o:spine/o:itemref',ns)]
 assert len(spine)==len(project['order'])
 documents={p:ET.fromstring(z.read(base+'/'+p)) for p in [v['href'] for v in items.values() if v['media-type']=='application/xhtml+xml']}
 expected={c['path']:c for c in provenance['chapters']}
 input_assets=[f for f in project['files'] if not f['path'].lower().endswith('.md')]
 assetmap={f['path']:f"assets/a{i}{Path(f['path']).suffix.lower()}" for i,f in enumerate(input_assets)}
 chaptermap=dict(zip(project['order'],spine));links_checked=0;images_checked=0
 for name,href in zip(project['order'],spine):
  node=documents[href];body=node.find('x:body',ns)
  actual=norm(''.join(body.itertext()));target=expected[name]['text']
  if actual!=target:
   import difflib
   delta='\n'.join(difflib.unified_diff(target.split(),actual.split(),n=3))
   raise AssertionError(f'Text differs for {name}:\n{delta[:4000]}')
  imgs=node.findall('.//x:img',ns);assert len(imgs)==len(expected[name]['images'])
  for img,src in zip(imgs,expected[name]['images']):
   assert img.attrib['src']==assetmap[src['path']] and img.attrib.get('alt')==src['alt']
   expected_hash=next(f['sha256'] for f in provenance['files'] if f['path']==src['path'])
   assert hashlib.sha256(z.read(base+'/'+img.attrib['src'])).hexdigest()==expected_hash;images_checked+=1
  actual_links=[a.attrib['href'] for a in node.findall('.//x:a',ns)]
  target_links=[]
  for link in expected[name]['links']:
   p=urlsplit(link);target_links.append(chaptermap[p.path]+('#'+p.fragment if p.fragment else ''))
  assert [unquote(s) for s in actual_links]==target_links
 # Check every internal link, including generated navigation, independently of provenance.
 for href,node in documents.items():
  ids=[n.attrib['id'] for n in node.iter() if 'id' in n.attrib];assert len(ids)==len(set(ids))
  for a in node.findall('.//x:a',ns):
   url=urlsplit(a.attrib['href'])
   if url.scheme:continue
   dest=posixpath.normpath(posixpath.join(posixpath.dirname(href),unquote(url.path))) if url.path else href
   assert dest in documents
   if url.fragment:assert any(n.attrib.get('id')==unquote(url.fragment) for n in documents[dest].iter())
   links_checked+=1
 nav=next(v['href'] for v in items.values() if v.get('properties')=='nav')
 assert [a.attrib['href'] for a in documents[nav].findall('.//x:nav/x:ol/x:li/x:a',ns)]==spine
 for f in provenance['files']:assert hashlib.sha256(Path('demo/manuscript',f['path']).read_bytes()).hexdigest()==f['sha256']
 for f in provenance['sources']:assert hashlib.sha256(Path(f['path']).read_bytes()).hexdigest()==f['sha256']
 # All payloads must appear in the manifest (directories and container excluded).
 expected_entries={base+'/'+v['href'] for v in items.values()}|{opf,'mimetype','META-INF/container.xml'}
 assert {n for n in z.namelist() if not n.endswith('/')}==expected_entries
 result={'epub':str(book),'chapters_text_equal':len(spine),'images_hash_and_alt_equal':images_checked,'internal_links_resolved':links_checked,'spine_and_navigation_equal':True,'source_hashes_unchanged':True}
 print(json.dumps(result,indent=2))
