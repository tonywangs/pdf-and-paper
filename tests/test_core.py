import copy
import io
import json
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from PIL import Image

import app as web
from desk import csv_bytes, edit, export_table, extract, inspect_pdf, replay, sha

ROOT=Path(__file__).resolve().parents[1]


def synthetic(text=True,multiline=False):
    out=io.BytesIO(); c=canvas.Canvas(out,pagesize=(300,200))
    if text:
        c.drawString(20,160,'001');c.drawString(150,160,'=2+3')
        if multiline:c.drawString(20,145,'second line')
        c.drawString(20,110,'"quoted", value');c.drawString(150,110,'last')
    else:
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(Image.new('RGB',(20,20),'black')),20,20)
    c.save();return out.getvalue()


def sample():
    p=json.loads((ROOT/'fixtures/presets.json').read_text())[0]
    t=extract((ROOT/'fixtures'/p['file']).read_bytes(),p['page'],p['region'],p['settings']);t['id']='test';t['title']='test';return t


def test_real_reference_hashes():
    for version in ['reference','reference-v2']:
        assert sha((ROOT/f'fixtures/{version}.json').read_bytes())==(ROOT/f'fixtures/{version}.sha256').read_text().split()[0]
    for d in json.loads((ROOT/'fixtures/sources.json').read_text())['documents']:
        assert sha((ROOT/'fixtures'/d['file']).read_bytes())==d['sha256']


def test_structural_edits_keep_source_and_undo():
    t=sample();original=copy.deepcopy(t['original'])
    for action in [{'kind':'set','row':0,'column':1,'value':'001'}, {'kind':'review','row':0,'column':1},
                   {'kind':'move_row','row':0,'destination':3}, {'kind':'move_column','column':0,'destination':3},
                   {'kind':'insert_row','row':1}, {'kind':'insert_column','column':1},
                   {'kind':'delete_row','row':0}, {'kind':'delete_column','column':0}]:
        before=replay(t);changed=edit(t,action)
        if action['kind'].startswith('delete'):assert changed['events'][-1]['removed']
        restored=edit(changed,{'kind':'undo'})
        assert replay(restored)==before
        assert restored['original']==original
        t=changed
    assert t['original']==original


def test_correction_resets_review_and_preserves_original():
    t=sample();t=edit(t,{'kind':'review','row':0,'column':1});assert replay(t)[0][1]['reviewed']
    t=edit(t,{'kind':'set','row':0,'column':1,'value':'001'});assert not replay(t)[0][1]['reviewed']
    assert t['original'][0][1]['value']!='001'
    assert replay(edit(t,{'kind':'undo'}))[0][1]['reviewed']


def test_csv_exact_strings_and_multiline():
    import csv
    values=['001','=2+3','a,b','a"b','line1\nline2','é','']
    data=csv_bytes([[{'value':x} for x in values]])
    assert list(csv.reader(io.StringIO(data.decode('utf-8'),newline='')))==[values]
    t=extract(synthetic(multiline=True),1,[10,25,280,100],{'columns':[140],'rows':[75],'layout':'multiline'})
    assert t['status']=='extracted'
    assert t['original'][0][0]['value']=='001\nsecond line'
    assert t['original'][0][1]['value']=='=2+3'


def test_unsupported_inputs():
    assert extract(synthetic(False),1,[0,0,300,200],{})['status']=='unsupported'
    for layout in ['merged','multipage']:
        assert extract(synthetic(),1,[0,0,300,200],{'layout':layout})['status']=='unsupported'
    assert extract(synthetic(),1,[0,0,300,200],{'layout':'multiline'})['status']=='unsupported'
    assert extract(synthetic(),1,[0,0,300,200],{'columns':[25]})['status']=='unsupported'
    writer=PdfWriter();writer.append(PdfReader(io.BytesIO(synthetic())));writer.pages[0].rotate(90);out=io.BytesIO();writer.write(out)
    assert extract(out.getvalue(),1,[0,0,100,100],{})['status']=='unsupported'
    writer=PdfWriter();writer.append(PdfReader(io.BytesIO(synthetic())));writer.encrypt('');out=io.BytesIO();writer.write(out)
    with pytest.raises(ValueError,match='Encrypted'):inspect_pdf(out.getvalue())
    with pytest.raises(ValueError):extract(synthetic(),1,[0,0,400,200],{})
    with pytest.raises(ValueError):extract(synthetic(),1,[0,0,300,200],{'columns':[150,100]})


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(web,'DATA',tmp_path)
    return web.app.test_client()


def test_source_reconnect_export_and_tamper_rejection(client):
    path=ROOT/'fixtures/ag-energy-round-up-2017-02-24.pdf'
    source=client.post('/api/pdf',data={'pdf':(io.BytesIO(path.read_bytes()),path.name)}).json
    t=sample();project={'schema':'pdf-table-review-project/v1','source':source,'tables':[t]}
    assert client.post('/api/project',json=project).status_code==200
    response=client.post('/api/export',json={'project':project,'table_id':'test'});assert response.status_code==200
    import zipfile,csv
    with zipfile.ZipFile(io.BytesIO(response.data)) as z:
        data=z.read('table.csv');manifest=json.loads(z.read('provenance.json'))
        assert sha(data)==manifest['output']['sha256']
        assert len(list(csv.reader(io.StringIO(data.decode()))))==6
    result=client.post('/api/pdf',data={'expected_sha256':source['sha256'],'pdf':(io.BytesIO(synthetic()),'other.pdf')})
    assert result.status_code==400 and 'hash mismatch' in result.json['error']
    t['original'][0][0]['value']='altered'
    assert client.post('/api/project',json=project).status_code==400
    assert client.post('/api/export',json={'project':project,'table_id':'test'}).status_code==400


def test_offline_project_and_cross_origin(client):
    t=sample();p={'schema':'pdf-table-review-project/v1','source':{'name':'missing.pdf','sha256':'a'*64},'tables':[t]}
    result=client.post('/api/project',json=p)
    assert result.status_code==200 and result.json['connected'] is False
    assert client.post('/api/export',json={'project':p,'table_id':'test'}).status_code==400
    assert client.post('/api/demo/ethanol',json={},headers={'Origin':'https://unrelated.example'}).status_code==403
    assert client.get('/',headers={'Host':'unrelated.example'}).status_code==400


def test_cell_undo_after_structure_and_large_review_history():
    t=sample()
    t=edit(t,{'kind':'set','row':0,'column':0,'value':'changed'})
    changed=replay(t)
    t=edit(t,{'kind':'delete_row','row':0})
    t=edit(t,{'kind':'undo'})
    assert replay(t)==changed
    t=edit(t,{'kind':'undo'})
    assert replay(t)==t['original']
    # Cell actions use small inverse snapshots, not whole-grid history copies.
    grid=[[{'id':str(i),'value':'001','bbox':None,'reviewed':False} for i in range(1000)]]
    large={'status':'extracted','original':grid,'events':[{'action':{'kind':'review','row':0,'column':c}} for c in range(600)]}
    reviewed=replay(large)
    assert sum(c['reviewed'] for c in reviewed[0])==600


def test_nonstandard_page_geometry_rejected_before_source_linking():
    for mode in ['crop','offset','scale']:
        writer=PdfWriter();writer.append(PdfReader(io.BytesIO(synthetic())))
        if mode=='crop':writer.pages[0].cropbox.lower_left=(10,10)
        elif mode=='offset':writer.pages[0].mediabox.lower_left=(10,10)
        else:
            from pypdf.generic import NameObject, NumberObject
            writer.pages[0][NameObject('/UserUnit')]=NumberObject(2)
        out=io.BytesIO();writer.write(out)
        with pytest.raises(ValueError,match='page boxes'):inspect_pdf(out.getvalue())
