"""Vector-preserving imposition. Page numbers in manifests are one-based."""
from pathlib import Path
import hashlib
import html
import json
import math
import shutil
import tempfile
import pymupdf as fitz

PAPERS = {"a4": (297 * 72 / 25.4, 210 * 72 / 25.4), "letter": (792, 612)}


def plan(count, signature):
    if count < 1:
        raise ValueError("Input must contain at least one page")
    if signature not in range(4, 65, 4):
        raise ValueError("Signature must be a multiple of four from 4 to 64 pages")
    sheets = []
    for sig, start in enumerate(range(1, count + 1, signature), 1):
        real = list(range(start, min(start + signature, count + 1)))
        pages = real + [None] * (-len(real) % 4)
        for depth in range(len(pages) // 4):
            sheets.append({"signature": sig, "sheet": depth + 1,
                           "front": [pages[-1 - 2 * depth], pages[2 * depth]],
                           "back": [pages[2 * depth + 1], pages[-2 - 2 * depth]]})
    return sheets


def folded(sheets):
    """Simulate nested leaves: right-front/back-left inward, then return outward."""
    sequence = []
    for sig in sorted({s["signature"] for s in sheets}):
        group = [s for s in sheets if s["signature"] == sig]
        sequence.extend(p for s in group for p in (s["front"][1], s["back"][0]))
        sequence.extend(p for s in reversed(group) for p in (s["back"][1], s["front"][0]))
    return sequence


def convert(source, output, paper="a4", signature=16, margin_mm=8):
    source, output = Path(source), Path(output)
    if output.exists():
        raise ValueError("Output directory already exists; choose a new directory")
    if paper not in PAPERS:
        raise ValueError("Paper must be a4 or letter")
    width, height = PAPERS[paper]
    margin = margin_mm * 72 / 25.4
    if not math.isfinite(margin) or margin < 0 or 2 * margin >= min(width / 2, height):
        raise ValueError("Margin must be finite, nonnegative, and leave room on each half-sheet")
    with fitz.open(source) as src:
        if not src.is_pdf or src.needs_pass or src.is_repaired:
            raise ValueError("Use an unencrypted, undamaged PDF")
        if len(src) > 1000:
            raise ValueError("At most 1000 input pages are supported")
        for page in src:
            if page.first_annot or page.first_widget:
                raise ValueError("Annotations or form fields found; flatten them in your PDF editor first")
            if page.rect.is_empty or page.rect.is_infinite:
                raise ValueError("Invalid source page size")
            # Preserve visible orientation before placing pages into new coordinate systems.
            page.remove_rotation()
        sheets = plan(len(src), signature)
        order = folded(sheets)
        if [p for p in order if p is not None] != list(range(1, len(src) + 1)):
            raise ValueError("Internal folded-order check failed")
        output.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".booklet-", dir=output.parent))
        try:
            manifest = {"format_version": 1, "source_name": source.name,
                        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                        "source_pages": len(src), "paper": paper, "size_points": [width, height],
                        "signature_limit": signature, "margin_mm": margin_mm,
                        "duplex": "landscape, flip on short edge", "sheets": sheets,
                        "folded_order": order, "blank_pages": order.count(None), "placements": []}
            with fitz.open() as dest:
                for sheet in sheets:
                    for side in ("front", "back"):
                        page = dest.new_page(width=width, height=height)
                        for half, number in enumerate(sheet[side]):
                            box = fitz.Rect(half * width / 2 + margin, margin,
                                            (half + 1) * width / 2 - margin, height - margin)
                            if number is not None:
                                # A truly blank source page has no content stream to import.
                                if src[number - 1].get_contents():
                                    page.show_pdf_page(box, src, number - 1, keep_proportion=True)
                            manifest["placements"].append({"page": number, "pdf_page": len(dest),
                                "signature": sheet["signature"], "sheet": sheet["sheet"],
                                "side": side, "half": half, "box": list(box)})
                dest.set_metadata({"title": source.stem + " — folded booklet",
                                   "subject": "Landscape; duplex short-edge; print actual size"})
                dest.save(stage / "booklet.pdf", garbage=4, deflate=True)
            with fitz.open(stage / "booklet.pdf") as printed:
                for i, page in enumerate(printed):
                    page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False).save(stage / f"side-{i+1}.png")
            (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            template = Path(__file__).with_name("preview.html").read_text()
            data = json.dumps(manifest).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
            (stage / "index.html").write_text(template.replace("__DATA__", data).replace("__TITLE__", html.escape(source.name)))
            stage.rename(output)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
    return manifest
