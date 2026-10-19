"""Exercise the file:// preview in Chromium without a web server."""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright
from booklet_fold.core import convert

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='booklet-browser-') as tmp:
    output=Path(tmp)/'out'
    convert(ROOT/'demo/sets.pdf',output,signature=8)
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={'width':1280,'height':900})
        errors=[];remote=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:remote.append(r.url) if r.url.startswith(('http:','https:')) else None)
        page.goto((output/'index.html').as_uri())
        assert page.locator('#summary').inner_text().startswith('sets.pdf · 11 pages + 1 blank')
        assert page.locator('#prev').is_disabled()
        assert 'Page 1' in page.locator('#spread').inner_text()
        page.locator('#next').click()
        assert 'Page 2' in page.locator('#spread').inner_text()
        assert 'Page 3' in page.locator('#spread').inner_text()
        page.locator('#signature').select_option('2')
        assert 'Page 9' in page.locator('#spread').inner_text()
        page.locator('#next').click()
        assert 'Page 10' in page.locator('#spread').inner_text()
        assert 'Page 11' in page.locator('#spread').inner_text()
        page.locator('#next').click()
        assert 'Blank padding' in page.locator('#spread').inner_text()
        assert page.locator('#next').is_disabled()
        page.locator('#side-1 button').filter(has_text='Page 8').click()
        assert page.locator('#signature').input_value()=='1'
        assert 'Page 8' in page.locator('#spread').inner_text()
        page.locator('#spread a').click()
        assert page.url.endswith('#side-1')
        assert page.locator('#accounting tr').count()==12
        # Eagerly load all preview images to verify local paths offline.
        page.locator('img').evaluate_all("imgs => imgs.forEach(i => i.loading='eager')")
        page.wait_for_function("Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)")
        page.locator('#signature').select_option('1')
        page.evaluate('window.scrollTo(0,0)')
        (ROOT/'build').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'build/preview-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(ROOT/'build/preview-mobile.png'),full_page=True)
        assert not errors,errors
        assert not remote,remote
        browser.close()
print('PASS: offline preview, signature selection, cover/spread navigation, bidirectional sheet links, blanks, local images, mobile width; no remote requests or JS errors')
