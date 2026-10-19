"""Optional real-browser smoke check. Run after installing playwright + Chromium."""
import json
from pathlib import Path
import tempfile

from playwright.sync_api import sync_playwright

from pdf_redaction_check.core import analyze
from pdf_redaction_check.demo import run_demo
from pdf_redaction_check.report import prepare, write_report


def main():
    with tempfile.TemporaryDirectory(prefix="pdf-check-browser-") as temp:
        root = Path(temp)
        demo = root / "demo"
        demo.mkdir()
        run_demo(demo)
        pdf = (demo / "rotated.pdf").read_bytes()
        regions = json.loads((demo / "rotated.regions.json").read_text())
        picker = root / "picker"
        picker.mkdir()
        prepare(pdf, picker)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1200, "height": 1000})
            errors, remote = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda req: remote.append(req.url) if req.url.startswith(("http:", "https:")) else None)
            page.goto((picker / "index.html").as_uri())
            svg = page.locator("svg.picker")
            svg.scroll_into_view_if_needed()
            b = svg.bounding_box()
            w, h = float(svg.get_attribute("data-width")), float(svg.get_attribute("data-height"))
            x0, y0, x1, y1 = regions["regions"][0]["rect"]
            page.mouse.move(b["x"] + x0 / w * b["width"], b["y"] + y0 / h * b["height"])
            page.mouse.down()
            page.mouse.move(b["x"] + x1 / w * b["width"], b["y"] + y1 / h * b["height"], steps=8)
            page.mouse.up()
            assert page.locator("#status").inner_text() == "1 region(s) selected"
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Download regions.json").click()
            downloaded = root / "downloaded.json"
            download_info.value.save_as(downloaded)
            selected = json.loads(downloaded.read_text())
            for actual, expected in zip(selected["regions"][0]["rect"], [x0, y0, x1, y1]):
                assert abs(actual - expected) < 1
            result = analyze(pdf, selected)
            assert "for Educators and Librarians" in result["regions"][0]["text"]
            report = root / "report"
            report.mkdir()
            write_report(pdf, result, report)
            page.goto((report / "index.html").as_uri())
            assert page.locator("img").evaluate("img => img.complete && img.naturalWidth > 0")
            page.locator('svg a[href="#region-1"]').click()
            assert page.url.endswith("#region-1")
            assert "for Educators and Librarians" in page.locator("article").inner_text()
            page.screenshot(path="/tmp/pdf-check-report-desktop.png", full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path="/tmp/pdf-check-report-mobile.png", full_page=True)
            assert not errors, errors
            assert not remote, remote
            browser.close()
    print("Browser smoke passed: rotated selection, JSON download, recovery, evidence links, local assets, mobile width.")


if __name__ == "__main__":
    main()
