"""Focused browser regression: draft selection and disconnected project recovery."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]


def test_draft_and_offline_recovery(tmp_path):
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    data=tmp_path/'pdfs'
    env={**os.environ,'PORT':str(port),'PDFDESK_DATA':str(data)}
    server=subprocess.Popen([str(ROOT/'.venv/bin/python'),'app.py'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    base=f'http://127.0.0.1:{port}'
    try:
        for _ in range(100):
            try:urllib.request.urlopen(base,timeout=1);break
            except Exception:time.sleep(.1)
        else:raise AssertionError('Server failed to start')
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1280,'height':1000},accept_downloads=True)
            page.goto(base)
            page.locator('[data-demo="biomass"]').click();expect(page.locator('#message')).to_contain_text('region ready')
            page.locator('#title').fill('Unsaved extraction draft');page.locator('#title').press('Tab')
            page.locator('#columns').fill('174, 244, 309')
            page.locator('#tolerance').fill('2.5');page.locator('#tolerance').press('Tab')
            page.reload();expect(page.locator('#title')).to_have_value('Unsaved extraction draft')
            expect(page.locator('#columns')).to_have_value('174, 244, 309')
            expect(page.locator('#tolerance')).to_have_value('2.5')
            expect(page.locator('#region')).to_have_value('20, 182, 380, 219')
            page.locator('#extract').click();expect(page.locator('#reviewCount')).to_have_text('0 / 12 reviewed')
            page.locator('#grid button[data-row="0"][data-column="0"]').click()
            page.locator('#review').click();expect(page.locator('#reviewCount')).to_have_text('1 / 12 reviewed')
            with page.expect_download() as dl:page.locator('#saveProject').click()
            saved=tmp_path/'project.json';dl.value.save_as(saved)
            # Simulate moving project JSON to a machine without its PDF.
            for pdf in data.glob('*.pdf'):pdf.unlink()
            page.evaluate('localStorage.clear()');page.reload()
            page.locator('#projectFile').set_input_files(saved)
            expect(page.locator('#reviewCount')).to_have_text('1 / 12 reviewed')
            page.locator('#export').click();expect(page.locator('#message')).to_contain_text('Reconnect the matching source PDF')
            page.locator('#reconnect').set_input_files(ROOT/'fixtures/ag-energy-round-up-2017-02-24.pdf')
            expect(page.locator('#message')).to_contain_text('PDF connected')
            expect(page.locator('#reviewCount')).to_have_text('1 / 12 reviewed')
            # A failed region attempt is retained across reload as a failed ledger entry.
            page.locator('#region').fill('0, 0, 9999, 9999');page.locator('#extract').click()
            expect(page.locator('#regions')).to_contain_text('failed')
            page.reload();expect(page.locator('#regions')).to_contain_text('failed')
            browser.close()
    finally:server.terminate();server.wait(timeout=10)
