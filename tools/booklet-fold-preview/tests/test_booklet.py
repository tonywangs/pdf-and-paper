import json
from pathlib import Path
import subprocess
import sys
import pymupdf as fitz
import pytest
from booklet_fold.core import convert, plan


def independently_unfold(sheets):
    result=[]
    for sig in sorted({s['signature'] for s in sheets}):
        nested=[]
        for sheet in reversed([s for s in sheets if s['signature']==sig]):
            nested=[sheet['front'][1],sheet['back'][0]]+nested+[sheet['back'][1],sheet['front'][0]]
        result.extend(nested)
    return result


@pytest.mark.parametrize('signature',range(4,65,4))
def test_all_page_counts(signature):
    for count in range(1,258):
        sheets=plan(count,signature)
        reading=independently_unfold(sheets)
        assert [p for p in reading if p is not None]==list(range(1,count+1))
        assert len(reading)==count+(-count%4)
        assert all(sum(s['signature']==sig for s in sheets)<=signature//4 for sig in {s['signature'] for s in sheets})


def test_known_eight_page_sheet():
    p=plan(8,8)
    assert [(s['front'],s['back']) for s in p]==[([8,1],[2,7]),([6,3],[4,5])]


def fixture(path):
    with fitz.open() as doc:
        for i in range(7):
            page=doc.new_page(width=360+(i%2)*120,height=540)
            page.draw_rect(fitz.Rect(2,2,page.rect.width-2,page.rect.height-2),color=(1,0,0),width=2)
            page.insert_text((12,25),f'TOP LEFT | PAGE {i+1}',fontsize=15)
            page.insert_text((12,510),'BOTTOM LEFT',fontsize=13)
            page.draw_circle((page.rect.width-30,60),20,color=(0,0,1),fill=(0,1,0))
            if i==4:
                page.set_cropbox(fitz.Rect(8,8,350,520))
            page.set_rotation((i%4)*90)
        doc.new_page(width=300,height=400)  # intentional blank source page
        page=doc.new_page(width=360,height=540)
        page.insert_text((20,60),'FINAL PAGE 9')
        doc.save(path)


@pytest.mark.parametrize('paper',['a4','letter'])
def test_rotations_crops_and_blank_source(tmp_path,paper):
    source=tmp_path/'mixed.pdf';fixture(source)
    dest=tmp_path/'booklet'
    m=convert(source,dest,paper,8,9)
    assert m['blank_pages']==3
    result=subprocess.run([sys.executable,'scripts/verify.py',str(source),str(dest)],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert (dest/'index.html').exists()


@pytest.mark.parametrize('signature',[0,3,6,68])
def test_bad_signatures(signature):
    with pytest.raises(ValueError):plan(5,signature)


@pytest.mark.parametrize('margin',[-1,float('nan'),float('inf'),100])
def test_bad_margin(tmp_path,margin):
    with pytest.raises(ValueError):convert('missing.pdf',tmp_path/'out',margin_mm=margin)


def test_existing_output_untouched(tmp_path):
    existing=tmp_path/'out';existing.mkdir();(existing/'keep').write_text('keep')
    with pytest.raises(ValueError):convert('missing.pdf',existing)
    assert (existing/'keep').read_text()=='keep'


def test_annotations_rejected(tmp_path):
    path=tmp_path/'annotated.pdf'
    with fitz.open() as doc:
        page=doc.new_page();page.add_text_annot((50,50),'must not silently disappear');doc.save(path)
    with pytest.raises(ValueError,match='Annotations'):convert(path,tmp_path/'out')
    assert not (tmp_path/'out').exists()


def test_encrypted_rejected(tmp_path):
    path=tmp_path/'secret.pdf'
    with fitz.open() as doc:
        doc.new_page();doc.save(path,encryption=fitz.PDF_ENCRYPT_AES_256,user_pw='test')
    with pytest.raises(ValueError,match='unencrypted'):convert(path,tmp_path/'out')


def test_verifier_detects_missing_content_and_rotation(tmp_path):
    source=tmp_path/'mixed.pdf';fixture(source)
    dest=tmp_path/'booklet';convert(source,dest,signature=8)
    pdf=dest/'booklet.pdf';original=pdf.read_bytes()
    for mode in ('missing','rotation'):
        with fitz.open(stream=original,filetype='pdf') as document:
            if mode=='missing':
                document[0].add_redact_annot(document[0].rect)
                document[0].apply_redactions()
            else:
                document[0].set_rotation(180)
            pdf.write_bytes(document.tobytes())
        checked=subprocess.run([sys.executable,'scripts/verify.py',str(source),str(dest)],capture_output=True,text=True)
        assert checked.returncode!=0,mode
        assert 'ink-normalized error' in checked.stderr,checked.stderr
