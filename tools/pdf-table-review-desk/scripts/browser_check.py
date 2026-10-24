"""Exercise the real browser workflow and create reproducible sample exports.
All reference corrections are explicit UI actions, never silent normalization.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import zipfile

from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]


def run(output):
    output.mkdir(parents=True,exist_ok=True)
    refs=json.loads((ROOT/'fixtures/reference-v2.json').read_text())['tables']
    presets=json.loads((ROOT/'fixtures/presets.json').read_text())
    with tempfile.TemporaryDirectory(prefix='pdfdesk-browser-') as temp:
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env={**os.environ,'PORT':str(port),'PDFDESK_DATA':str(Path(temp)/'data')}
        server=subprocess.Popen([str(ROOT/'.venv/bin/python'),'app.py'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        base=f'http://127.0.0.1:{port}'
        try:
            for _ in range(100):
                try:urllib.request.urlopen(base,timeout=1);break
                except Exception:time.sleep(.1)
            else:raise RuntimeError('Server failed to start')
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
                context=browser.new_context(viewport={'width':1440,'height':1100},accept_downloads=True)
                page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base)
                # Actual file input import, followed by drag selection on the rendered PDF.
                page.locator('#pdfFile').set_input_files(ROOT/'fixtures/ag-energy-round-up-2017-02-24.pdf')
                expect(page.locator('#sourceName')).to_have_text('ag-energy-round-up-2017-02-24.pdf')
                expect(page.locator('#message')).to_contain_text('PDF connected')
                for index,(ref,preset) in enumerate(zip(refs,presets)):
                    if index:
                        page.locator(f'[data-demo="{ref["id"]}"]').click()
                        expect(page.locator('#message')).to_contain_text('region ready')
                    else:
                        box=page.locator('#sourceSvg').bounding_box()
                        x0,y0,x1,y1=preset['region']
                        page.mouse.move(box['x']+x0/792*box['width'],box['y']+y0/612*box['height'])
                        page.mouse.down();page.mouse.move(box['x']+x1/792*box['width'],box['y']+y1/612*box['height']);page.mouse.up()
                        assert page.locator('#region').input_value()
                        # Exact recorded bounds remove viewport-dependent rounding from the benchmark.
                        page.locator('#region').fill(', '.join(map(str,preset['region'])))
                        page.locator('#columns').fill(', '.join(map(str,preset['settings']['columns'])))
                        page.locator('#title').fill(preset['title'])
                    page.locator('#extract').click()
                    expect(page.locator('#reviewCount')).to_have_text(f'0 / {len(ref["rows"])*4} reviewed')
                    expect(page.locator('#grid tbody tr')).to_have_count(len(ref['rows']))
                    if index==0:
                        page.locator('#grid button[data-row="0"][data-column="1"]').click()
                        expect(page.locator('#highlight')).to_have_attribute('visibility','visible')
                        expect(page.locator('#originalValue')).to_have_text('1.35- 1.42')
                        page.locator('#cellValue').fill('temporary edit')
                        page.locator('#correct').click();expect(page.locator('#cellValue')).to_have_value('temporary edit')
                        page.locator('#undo').click();expect(page.locator('#cellValue')).to_have_value('1.35- 1.42')
                        page.locator('[data-action="insert_row"]').click();expect(page.locator('#grid tbody tr')).to_have_count(7)
                        page.locator('#undo').click();expect(page.locator('#grid tbody tr')).to_have_count(6)
                        page.locator('[data-action="insert_column"]').click();expect(page.locator('#grid thead th')).to_have_count(6)
                        page.locator('#undo').click();expect(page.locator('#grid thead th')).to_have_count(5)
                        page.on('dialog',lambda dialog:dialog.accept())
                        page.locator('[data-action="delete_row"]').click();expect(page.locator('#grid tbody tr')).to_have_count(5)
                        page.locator('#undo').click();expect(page.locator('#grid tbody tr')).to_have_count(6)
                        page.locator('[data-action="delete_column"]').click();expect(page.locator('#grid thead th')).to_have_count(4)
                        page.locator('#undo').click();expect(page.locator('#grid thead th')).to_have_count(5)
                        page.locator('[data-move="down"]').click();expect(page.locator('#grid button[data-row="1"][data-column="0"]')).to_have_text('Iowa')
                        page.locator('#undo').click();expect(page.locator('#grid button[data-row="0"][data-column="0"]')).to_have_text('Iowa')
                        page.locator('#grid button[data-row="0"][data-column="0"]').click()
                        page.locator('[data-move="right"]').click();expect(page.locator('#grid button[data-row="0"][data-column="1"]')).to_have_text('Iowa')
                        page.locator('#undo').click();expect(page.locator('#grid button[data-row="0"][data-column="0"]')).to_have_text('Iowa')
                    for r,row in enumerate(ref['rows']):
                        for c,value in enumerate(row):
                            cell=page.locator(f'#grid button[data-row="{r}"][data-column="{c}"]')
                            cell.click()
                            if page.locator('#cellValue').input_value()!=value:
                                page.locator('#cellValue').fill(value);page.locator('#correct').click()
                                expect(cell).to_have_text(value)
                            page.locator('#review').click();expect(cell).to_have_class('checked selected')
                    expect(page.locator('#reviewCount')).to_have_text(f'{len(ref["rows"])*4} / {len(ref["rows"])*4} reviewed')
                    if index==0:
                        page.reload();expect(page.locator('#message')).to_contain_text('Recovered your saved review')
                        expect(page.locator('#reviewCount')).to_have_text('24 / 24 reviewed')
                        # Project round-trip and same-name/different-bytes reconnection rejection.
                        with page.expect_download() as dl:page.locator('#saveProject').click()
                        project_file=Path(temp)/'project.json';dl.value.save_as(project_file)
                        page.evaluate('localStorage.clear()');page.reload()
                        page.locator('#projectFile').set_input_files(project_file)
                        expect(page.locator('#message')).to_contain_text('Project restored and checked')
                        page.locator('#reconnect').set_input_files(ROOT/'fixtures/background-checks.pdf')
                        expect(page.locator('#message')).to_contain_text('Source hash mismatch')
                        page.locator('#reconnect').set_input_files(ROOT/'fixtures/ag-energy-round-up-2017-02-24.pdf')
                        expect(page.locator('#message')).to_contain_text('PDF connected')
                    # Activate the table again after recovery when needed.
                    page.locator('#regions button').filter(has_text=preset['title']).last.click()
                    with page.expect_download() as dl:page.locator('#export').click()
                    archive=Path(temp)/(ref['id']+'.zip');dl.value.save_as(archive)
                    with zipfile.ZipFile(archive) as z:
                        (output/(ref['id']+'.csv')).write_bytes(z.read('table.csv'))
                        manifest=json.loads(z.read('provenance.json'))
                        manifest['benchmark']={'reference':'fixtures/reference-v2.json','table_id':ref['id']}
                        (output/(ref['id']+'.provenance.json')).write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
                    with page.expect_download() as dl:page.locator('#saveProject').click()
                    dl.value.save_as(output/(ref['id']+'.project.json'))
                    if index==0:
                        page.locator('#grid button[data-row="0"][data-column="1"]').click()
                        page.locator('#sourceSvg').scroll_into_view_if_needed()
                        page.screenshot(path=str(output/'browser-demo.png'),full_page=True)
                    print(f'Browser verified {ref["id"]}: {len(ref["rows"])} rows, {len(ref["rows"])*4} cells',flush=True)
                # Explicit unsupported-region ledger, followed by reload recovery.
                page.locator('#layout').select_option('merged');page.locator('#title').fill('Unsupported merged selection')
                page.locator('#extract').click();expect(page.locator('#message')).to_contain_text('Merged cells')
                page.reload();expect(page.locator('#regions')).to_contain_text('unsupported')
                assert not errors,errors
                browser.close()
        finally:server.terminate();server.wait(timeout=10)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'examples');args=parser.parse_args();run(args.output)
