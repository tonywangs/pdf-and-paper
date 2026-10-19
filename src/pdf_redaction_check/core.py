"""Read-only PDF analysis; all rectangles are in displayed, rotated page points."""
from __future__ import annotations

import hashlib
import io
import math
from pathlib import Path

import pymupdf as fitz
import pypdf

COORDINATES = "displayed-page-points-top-left"
LIMITATIONS = [
    "No detected text does not certify secure redaction. Only the supplied regions are checked for positioned text.",
    "Images, image masks, vector-outlined text and OCR are not decoded for hidden content; scanned text may remain recoverable.",
    "Attachments, metadata, form values, annotation payloads other than redaction markers, scripts and hidden layers are not exhaustively inspected.",
    "Historical revisions, unused objects and deleted streams are not searched. The current parsed page is not the whole file.",
    "Inference attacks, font/encoding failures and parser differences are outside this check. Visible previews are not proof of removal.",
    "pypdf evidence is whole-page text, not an independent spatial check; a matching fragment can occur elsewhere on that page.",
    "Glyph bounding boxes are approximate. Any positive-area overlap is flagged; decorative rectangles are not automatically treated as redactions.",
]


class InputError(ValueError):
    pass


def open_pdf(data: bytes):
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise InputError(f"Cannot open PDF: {exc}") from exc
    if not doc.is_pdf or doc.needs_pass:
        doc.close()
        raise InputError("Expected an unencrypted PDF (password-protected inputs are unsupported).")
    if not len(doc):
        doc.close()
        raise InputError("PDF has no pages.")
    return doc


def validate_regions(spec, doc):
    if not isinstance(spec, dict) or spec.get("coordinate_system") != COORDINATES:
        raise InputError(f"Set coordinate_system to {COORDINATES!r}.")
    items = spec.get("regions")
    if not isinstance(items, list) or not items:
        raise InputError("regions must be a nonempty list.")
    result, ids = [], set()
    for i, item in enumerate(items, 1):
        if not isinstance(item, dict):
            raise InputError(f"Region {i} must be an object.")
        page, coords = item.get("page"), item.get("rect")
        name = item.get("id", f"region-{i}")
        if not isinstance(name, str) or not name.strip() or name in ids:
            raise InputError(f"Region {i}: id must be a unique nonempty string.")
        if type(page) is not int or not 1 <= page <= len(doc):
            raise InputError(f"Region {i}: page must be an integer from 1 to {len(doc)}.")
        if (not isinstance(coords, list) or len(coords) != 4 or
                any(type(x) not in (int, float) or not math.isfinite(x) for x in coords)):
            raise InputError(f"Region {i}: rect must contain four finite numbers.")
        rect = fitz.Rect(coords)
        if rect.is_empty or not doc[page - 1].rect.contains(rect):
            raise InputError(f"Region {i}: rectangle must have positive area and lie within displayed page {page} ({list(doc[page - 1].rect)}).")
        ids.add(name)
        result.append({"id": name, "page": page, "rect": list(rect)})
    return result


def overlaps(a, b):
    return not (fitz.Rect(a) & fitz.Rect(b)).is_empty


def normalized(text):
    return "".join(text.split())


def analyze(data: bytes, spec, filename="input.pdf"):
    """Return serializable evidence; never save or alter the source document."""
    with open_pdf(data) as doc:
        regions = validate_regions(spec, doc)
        result = {
            "schema_version": 1, "input": {"name": Path(filename).name,
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "pages": len(doc)},
            "coordinate_system": COORDINATES,
            "engines": {"pymupdf": fitz.VersionBind, "pypdf": pypdf.__version__},
            "limitations": LIMITATIONS, "regions": [], "redaction_annotations": [],
            "pages": [], "errors": [],
        }
        if doc.is_repaired:
            result["errors"].append("PyMuPDF repaired the input: extraction may be incomplete.")
        try:
            independent = pypdf.PdfReader(io.BytesIO(data), strict=False)
            independent_error = None
        except Exception as exc:
            independent, independent_error = None, f"{type(exc).__name__}: {exc}"
        requested = {r["page"] for r in regions}
        # Redaction markers are examined on every page, including outside requested regions.
        for number, page in enumerate(doc, 1):
            try:
                annotations = list(page.annots() or [])
                for annot in annotations:
                    if annot.type[0] == fitz.PDF_ANNOT_REDACT:
                        result["redaction_annotations"].append({"page": number, "xref": annot.xref,
                            "rect": list(annot.rect * page.rotation_matrix),
                            "finding": "unapplied_redaction_annotation"})
                        requested.add(number)
            except Exception as exc:
                result["errors"].append(f"Page {number}: annotation inspection failed: {exc}")
        for number in sorted(requested):
            page = doc[number - 1]
            page_data = {"page": number, "width": page.rect.width, "height": page.rect.height,
                         "rotation": page.rotation, "pypdf_text": "", "pypdf_error": independent_error,
                         "text_error": None, "image_error": None}
            if independent is not None:
                try:
                    page_data["pypdf_text"] = independent.pages[number - 1].extract_text() or ""
                except Exception as exc:
                    page_data["pypdf_error"] = f"{type(exc).__name__}: {exc}"
            chars = []
            try:
                raw = page.get_text("rawdict", flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES,
                                    clip=fitz.INFINITE_RECT())
                for bi, block in enumerate(raw["blocks"]):
                    for li, line in enumerate(block.get("lines", [])):
                        for span in line["spans"]:
                            for char in span["chars"]:
                                chars.append({"text": char["c"], "rect": list(fitz.Rect(char["bbox"]) * page.rotation_matrix),
                                              "line": [bi, li]})
            except Exception as exc:
                page_data["text_error"] = f"{type(exc).__name__}: {exc}"
            try:
                images = [list(fitz.Rect(im["bbox"]) * page.rotation_matrix) for im in page.get_image_info()]
            except Exception as exc:
                images = []
                page_data["image_error"] = f"{type(exc).__name__}: {exc}"
            for region in (r for r in regions if r["page"] == number):
                hits = [c for c in chars if overlaps(c["rect"], region["rect"])]
                lines = {}
                for char in hits:
                    lines.setdefault(tuple(char["line"]), []).append(char["text"])
                fragments = ["".join(line) for line in lines.values()]
                recovered = "\n".join(fragments)
                has_text = bool(recovered.strip())
                matches = [fragment for fragment in fragments if normalized(fragment) and
                           normalized(fragment) in normalized(page_data["pypdf_text"])]
                findings = []
                if has_text:
                    findings.append("recoverable_text")
                if any(a["page"] == number and overlaps(a["rect"], region["rect"])
                       for a in result["redaction_annotations"]):
                    findings.append("unapplied_redaction_annotation")
                image_count = sum(overlaps(box, region["rect"]) for box in images)
                if image_count:
                    findings.append("unsupported_image_content")
                if page_data["text_error"]:
                    findings.append("text_check_failed")
                elif not has_text:
                    findings.append("no_text_detected_not_certified")
                crosscheck = ("unavailable" if page_data["pypdf_error"] else
                              "no_region_text_to_compare" if not has_text else
                              "all_fragments_found_on_page" if len(matches) == len([f for f in fragments if normalized(f)]) else
                              "partial_or_no_match_on_page")
                result["regions"].append({**region, "findings": findings, "text": recovered,
                    "characters": hits, "overlapping_images": image_count,
                    "independent_check": {"scope": "whole_page_not_spatial", "status": crosscheck,
                                          "matching_fragments": matches}})
            result["pages"].append(page_data)
            for field in ("text_error", "pypdf_error", "image_error"):
                if page_data[field]:
                    result["errors"].append(f"Page {number} {field}: {page_data[field]}")
        positive = bool(result["redaction_annotations"]) or any("recoverable_text" in r["findings"] for r in result["regions"])
        result["outcome"] = "findings_detected" if positive else "no_text_detected_not_certified"
        result["checks_incomplete"] = bool(result["errors"])
        result["exit_code"] = 2 if result["errors"] else 1 if positive else 0
        return result
