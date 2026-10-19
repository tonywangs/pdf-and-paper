"""Self-contained local HTML evidence and an optional visual rectangle picker."""
from __future__ import annotations

from contextlib import contextmanager
import html
import json
import os
from pathlib import Path
import shutil
import tempfile

import pymupdf as fitz

from .core import COORDINATES, InputError, LIMITATIONS, open_pdf

CSS = """
body{font:16px/1.5 system-ui,sans-serif;color:#172431;background:#f4f6f8;margin:auto;max-width:1100px;padding:24px}
h1,h2{line-height:1.2}a{color:#07598c}section,article{background:white;border:1px solid #c8d1db;border-radius:8px;padding:20px;margin:20px 0}
.warning{border-left:5px solid #b85800;padding:12px;background:#fff3df}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:12px}
.page{position:relative;border:1px solid #8393a3;margin:12px 0}.page img{display:block;width:100%}.page svg{position:absolute;inset:0;width:100%;height:100%}
rect.region{fill:#ff6a0014;stroke:#dc4900;stroke-width:2}rect.annotation{fill:none;stroke:#a400bb;stroke-dasharray:6 3;stroke-width:2}
svg text{fill:#fff;stroke:#222;paint-order:stroke;stroke-width:2;font-size:14px}button{padding:10px 18px;cursor:pointer}small{color:#425466}code{overflow-wrap:anywhere}
.picker{touch-action:none;cursor:crosshair}.sticky{position:sticky;top:0;background:#f4f6f8;padding:12px;z-index:2}
"""


def escape(value):
    return html.escape(str(value), quote=True)


def shell(title, body, script=""):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>{escape(title)}</title><style>{CSS}</style></head><body><h1>{escape(title)}</h1>{body}{script}</body></html>'''


@contextmanager
def output_directory(destination):
    """Publish a complete directory only; never overwrite inputs or previous reports."""
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise InputError(f"Output already exists: {destination}; choose a new directory.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".pdf-check-", dir=destination.parent))
    try:
        yield temporary
        # mkdir is exclusive, including when another process created the destination.
        destination.mkdir(mode=0o700)
        for child in temporary.iterdir():
            shutil.move(str(child), str(destination / child.name))
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def write_text(path, text):
    path.write_text(text, encoding="utf-8")
    path.chmod(0o600)


def write_json(path, value):
    write_text(path, json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def render_page(page, directory, number):
    # Bound preview size even when a PDF declares extremely large page dimensions.
    scale = min(1.5, 1600 / max(page.rect.width, page.rect.height))
    if scale <= 0:
        raise InputError("Cannot render a page with invalid dimensions.")
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    filename = f"page-{number}.png"
    (directory / filename).write_bytes(pix.tobytes("png"))
    (directory / filename).chmod(0o600)
    return filename


def rectangle(rect, css, label=None, anchor=None):
    x0, y0, x1, y1 = rect
    drawing = f'<rect class="{css}" x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}"/>'
    if label:
        drawing += f'<text x="{x0+2}" y="{max(14, y0-3)}">{escape(label)}</text>'
    return f'<a href="#{anchor}">{drawing}</a>' if anchor else drawing


def write_report(data, result, directory):
    write_json(directory / "report.json", result)
    warning = "No detected text does not certify secure redaction. This report contains recovered text and page previews; treat it as sensitive."
    body = f'<p class="warning">{warning}</p><p><strong>{escape(result["outcome"])}</strong> · checks incomplete: {result["checks_incomplete"]}</p>'
    body += f'<p>Input: {escape(result["input"]["name"])}<br>SHA-256: <code>{result["input"]["sha256"]}</code><br>Engines: {escape(result["engines"])}</p>'
    body += '<p><a href="report.json">Machine-readable evidence</a> · Orange: intended region; purple: unapplied annotation. Click a region label for its evidence.</p>'
    body += '<details><summary>Scope and unsupported checks (always apply)</summary><ul>' + ''.join(f'<li>{escape(s)}</li>' for s in LIMITATIONS) + '</ul></details>'
    if result["errors"]:
        body += '<section class="warning"><h2>Incomplete checks</h2><ul>' + ''.join(f'<li>{escape(e)}</li>' for e in result["errors"]) + '</ul></section>'
    with open_pdf(data) as doc:
        for page_data in result["pages"]:
            number = page_data["page"]
            filename = render_page(doc[number - 1], directory, number)
            width, height = page_data["width"], page_data["height"]
            overlays, cards = "", ""
            for i, region in enumerate(result["regions"], 1):
                if region["page"] != number:
                    continue
                anchor = f"region-{i}"
                overlays += rectangle(region["rect"], "region", f"R{i}", anchor)
                cards += f'<article id="{anchor}"><h3>R{i}: {escape(region["id"])}</h3><p>{escape(", ".join(region["findings"]))}</p><p>Page {number} · rectangle {escape(region["rect"])}</p>'
                cards += f'<pre>{escape(region["text"]) if region["text"] else "(No text detected; not certified.)"}</pre>'
                cards += f'<p>Independent page-text comparison: {escape(region["independent_check"]["status"])}. This does not independently locate text in the rectangle.</p></article>'
            markers = [a for a in result["redaction_annotations"] if a["page"] == number]
            for a in markers:
                overlays += rectangle(a["rect"], "annotation")
            body += f'<section id="page-{number}"><h2>Page {number}</h2><p>Displayed size {width:g} × {height:g} points; rotation {page_data["rotation"]}°. Unapplied redaction annotations: {len(markers)}.</p>'
            body += f'<div class="page"><img src="{filename}" alt="Rendered input page {number}"><svg viewBox="0 0 {width} {height}" aria-label="Inspection rectangles">{overlays}</svg></div>{cards}'
            body += f'<details><summary>Independent pypdf extraction — entire page {number}</summary><pre>{escape(page_data["pypdf_text"])}</pre></details></section>'
    write_text(directory / "index.html", shell("PDF redaction inspection", body))


PICKER_SCRIPT = '''<script>
const regions=[]; let start=null;
const status=document.getElementById('status');
function refresh(){status.textContent=regions.length+' region(s) selected';document.getElementById('json').textContent=JSON.stringify({coordinate_system:'displayed-page-points-top-left',regions},null,2);}
for(const svg of document.querySelectorAll('svg.picker')){
 const point=e=>{const r=svg.getBoundingClientRect();return [Math.max(0,Math.min(+svg.dataset.width,(e.clientX-r.left)/r.width*+svg.dataset.width)),Math.max(0,Math.min(+svg.dataset.height,(e.clientY-r.top)/r.height*+svg.dataset.height))];};
 svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;svg.setPointerCapture(e.pointerId);start={svg,p:point(e),id:e.pointerId};});
 svg.addEventListener('pointerup',e=>{if(!start||start.svg!==svg)return;const end=point(e),p=start.p;start=null;const box=[Math.min(p[0],end[0]),Math.min(p[1],end[1]),Math.max(p[0],end[0]),Math.max(p[1],end[1])].map(n=>Math.round(n*1000)/1000);if(box[2]-box[0]<1||box[3]-box[1]<1)return;
 const region={id:'region-'+(regions.length+1),page:+svg.dataset.page,rect:box};regions.push(region);const r=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [k,v] of Object.entries({x:box[0],y:box[1],width:box[2]-box[0],height:box[3]-box[1],class:'region'}))r.setAttribute(k,v);svg.append(r);refresh();});
 svg.addEventListener('pointercancel',()=>{start=null;});
}
document.getElementById('clear').onclick=()=>{regions.length=0;document.querySelectorAll('svg rect').forEach(r=>r.remove());refresh();};
document.getElementById('download').onclick=()=>{if(!regions.length){status.textContent='Select at least one rectangle first.';return;}const blob=new Blob([document.getElementById('json').textContent+'\\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='regions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
refresh();
</script>'''


def prepare(data, directory, pages=None):
    body = '<p>Drag across each intended redaction region, then download regions.json and run the checker. Coordinates use the displayed page, including its rotation. No PDF content is uploaded or changed.</p><p class="warning">These previews may contain sensitive information. Selection requires a pointer; you can also write the documented JSON format directly.</p>'
    body += '<div class="sticky"><button id="download">Download regions.json</button> <button id="clear">Clear all</button> <span id="status" role="status"></span></div>'
    with open_pdf(data) as doc:
        selected = pages or list(range(1, len(doc) + 1))
        if any(type(p) is not int or not 1 <= p <= len(doc) for p in selected):
            raise InputError(f"Pages must lie between 1 and {len(doc)}.")
        for n in sorted(set(selected)):
            page = doc[n - 1]
            name = render_page(page, directory, n)
            w, h = page.rect.width, page.rect.height
            body += f'<section><h2>Page {n}</h2><p>{w:g} × {h:g} points</p><div class="page"><img src="{name}" alt="Page {n}"><svg class="picker" data-page="{n}" data-width="{w}" data-height="{h}" viewBox="0 0 {w} {h}" aria-label="Drag to select regions on page {n}"></svg></div></section>'
    body += '<details><summary>Selected region JSON</summary><pre id="json"></pre></details>'
    write_text(directory / "index.html", shell("Select intended redaction regions", body, PICKER_SCRIPT))
