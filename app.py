"""Loopback-only browser workbench; PDF data stays on this machine."""
import io
import json
import os
import re
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
import pypdfium2 as pdfium

from desk import MAX_BYTES, edit, export_table, extract, inspect_pdf, replay, sha

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('PDFDESK_DATA',ROOT/'.data'))
app=Flask(__name__,static_folder='static',static_url_path='/static')
app.config.update(MAX_CONTENT_LENGTH=MAX_BYTES+1024*1024, TRUSTED_HOSTS=['127.0.0.1','localhost','[::1]'])


@app.before_request
def local_only():
    origin=request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host:
        return jsonify(error='Cross-origin requests are not allowed.'),403
    if request.headers.get('Sec-Fetch-Site') == 'cross-site':
        return jsonify(error='Cross-site requests are not allowed.'),403


@app.after_request
def headers(response):
    response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Content-Security-Policy']="default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    return response


@app.errorhandler(Exception)
def errors(error):
    if isinstance(error,HTTPException):
        return jsonify(error=error.description),error.code
    if isinstance(error,(ValueError,KeyError,TypeError,IndexError)):
        return jsonify(error=str(error)),400
    app.logger.exception('Request failed')
    return jsonify(error='Unable to process this PDF or project. Check its format and limits.'),422


def source_path(digest):
    if not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest):
        raise ValueError('Invalid source hash.')
    return DATA/(digest+'.pdf')


def source_data(digest):
    path=source_path(digest)
    if not path.exists():
        raise ValueError('Reconnect the matching source PDF first.')
    data=path.read_bytes()
    if sha(data)!=digest:
        raise ValueError('Stored PDF hash mismatch. Reconnect the original source.')
    return data


def import_pdf(data,name):
    pages=inspect_pdf(data)
    digest=sha(data)
    DATA.mkdir(parents=True,exist_ok=True)
    path=source_path(digest)
    if not path.exists():
        temporary=DATA/(str(uuid.uuid4())+'.tmp')
        temporary.write_bytes(data);temporary.replace(path)
    source={'name':Path(name).name[:200],'sha256':digest,'bytes':len(data),'pages':pages}
    provenance=ROOT/'fixtures'/'sources.json'
    if provenance.exists():
        for s in json.loads(provenance.read_text())['documents']:
            if s['sha256']==digest:
                source['provenance']=s
    return source


def validate_project(project, verify_source=False):
    if not isinstance(project,dict) or project.get('schema')!='pdf-table-review-project/v1':
        raise ValueError('Unsupported project format.')
    source=project['source']; source_path(source['sha256'])
    if not isinstance(source.get('name'),str):
        raise ValueError('Source name is missing.')
    tables=project.get('tables')
    if not isinstance(tables,list) or len(tables)>100:
        raise ValueError('A project may contain at most 100 regions.')
    seen=set()
    data=source_data(source['sha256']) if verify_source else None
    for table in tables:
        if not re.fullmatch('[A-Za-z0-9_-]{1,80}',table['id']) or table['id'] in seen:
            raise ValueError('Region identifiers must be unique and safe.')
        seen.add(table['id'])
        if table['status'] not in ['extracted','unsupported','failed']:
            raise ValueError('Unknown region status.')
        replay(table)
        if data is not None and table['status']!='failed':
            original=extract(data,table['page'],table['region'],table['settings'])
            if original['original']!=table['original'] or original['status']!=table['status']:
                raise ValueError('Original extraction does not match the source and settings. Keep the original app version or re-extract as a new region.')
    return project


@app.get('/')
def home():
    return app.send_static_file('index.html')


@app.get('/api/demos')
def demos():
    return jsonify(json.loads((ROOT/'fixtures/presets.json').read_text()))


@app.post('/api/demo/<name>')
def demo(name):
    presets=json.loads((ROOT/'fixtures/presets.json').read_text())
    preset=next((x for x in presets if x['id']==name),None)
    if preset is None:
        raise ValueError('Unknown demo.')
    data=(ROOT/'fixtures'/preset['file']).read_bytes()
    return jsonify(source=import_pdf(data,preset['file']),preset=preset)


@app.post('/api/pdf')
def upload():
    f=request.files['pdf']; data=f.read(MAX_BYTES+1)
    expected=request.form.get('expected_sha256')
    if expected and sha(data)!=expected:
        raise ValueError('Source hash mismatch: this is not the PDF used by the saved project.')
    return jsonify(import_pdf(data,f.filename or 'document.pdf'))


@app.get('/api/page/<digest>/<int:number>.png')
def page_image(digest,number):
    data=source_data(digest)
    pages=inspect_pdf(data)
    if not 1<=number<=len(pages):
        raise ValueError('Page out of range.')
    with pdfium.PdfDocument(data) as pdf:
        page=pdf[number-1]
        bitmap=page.render(scale=1.5)
        image=bitmap.to_pil();out=io.BytesIO();image.save(out,format='PNG')
        bitmap.close();page.close()
    out.seek(0)
    return send_file(out,mimetype='image/png')


@app.post('/api/extract')
def extraction():
    body=request.get_json();data=source_data(body['sha256'])
    table=extract(data,body['page'],body['region'],body['settings'])
    table['id']=str(uuid.uuid4());table['title']=str(body.get('title','Selected region'))[:200]
    return jsonify(table=table,grid=replay(table))


@app.post('/api/edit')
def editing():
    body=request.get_json();table=edit(body['table'],body['action'])
    return jsonify(table=table,grid=replay(table))


@app.post('/api/project')
def project_import():
    project=validate_project(request.get_json())
    connected=source_path(project['source']['sha256']).exists()
    if connected:
        validate_project(project,verify_source=True)
    return jsonify(project=project,grids={t['id']:replay(t) for t in project['tables']},connected=connected)


@app.post('/api/export')
def exporting():
    body=request.get_json();project=validate_project(body['project'],verify_source=True)
    table=next(t for t in project['tables'] if t['id']==body['table_id'])
    data,manifest=export_table(project,table)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('table.csv',data)
        z.writestr('provenance.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    out.seek(0)
    return send_file(out,mimetype='application/zip',as_attachment=True,download_name=table['id']+'-export.zip')


if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.environ.get('PORT','8765')),debug=False,threaded=False)
