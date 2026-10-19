"""Deterministic controlled variants of a provenance-pinned real public PDF."""
from __future__ import annotations

import hashlib
from importlib.resources import files
import json

import pymupdf as fitz

from .core import COORDINATES, InputError, analyze, normalized
from .report import escape, shell, write_json, write_report, write_text


def run_demo(directory):
    resource = files("pdf_redaction_check").joinpath("data")
    source = resource.joinpath("cc-book-sample.pdf").read_bytes()
    provenance = json.loads(resource.joinpath("provenance.json").read_text(encoding="utf-8"))
    if hashlib.sha256(source).hexdigest() != provenance["sha256"]:
        raise InputError("Bundled source hash differs from provenance; refusing to run demo.")
    write_json(directory / "provenance.json", provenance)
    target = provenance["target"]
    cases = [
        ("original", "Unmodified title-page extraction: visible text is recoverable.", True),
        ("masked", "A black rectangle covers the subtitle; underlying text remains.", True),
        ("applied", "Redaction is applied and the file saved with garbage collection.", False),
        ("annotation", "A redaction annotation is added but never applied.", True),
        ("rotated", "The masked title page is rotated clockwise 90 degrees.", True),
        ("decorative", "An ordinary rectangle in a blank margin is selected; it is not called a redaction.", False),
    ]
    records, links = [], []
    for name, description, expected_text in cases:
        with fitz.open(stream=source, filetype="pdf") as original, fitz.open() as doc:
            doc.insert_pdf(original, from_page=0, to_page=0)
            page = doc[0]
            matches = page.search_for(target)
            if len(matches) != 1:
                raise InputError("Expected one target subtitle in the pinned public PDF.")
            # The title above has a tall font box extending below its ink. Start
            # inside the subtitle box to avoid selecting that neighboring line.
            box = matches[0] + (-1, 5, 1, 1)
            if name in ("masked", "rotated"):
                page.draw_rect(box, color=(0, 0, 0), fill=(0, 0, 0), overlay=True)
            elif name in ("applied", "annotation"):
                page.add_redact_annot(box, fill=(0, 0, 0))
                if name == "applied":
                    page.apply_redactions()
            elif name == "decorative":
                box = fitz.Rect(20, 20, 80, 40)
                page.draw_rect(box, color=(0, 0, 0), fill=(0, 0, 0))
            if name == "rotated":
                page.set_rotation(90)
            region = list(box * page.rotation_matrix)
            data = doc.tobytes(garbage=4, deflate=True, no_new_id=True)
        pdf_path = directory / f"{name}.pdf"
        pdf_path.write_bytes(data)
        pdf_path.chmod(0o600)
        spec = {"coordinate_system": COORDINATES, "regions": [{"id": name, "page": 1, "rect": region}]}
        write_json(directory / f"{name}.regions.json", spec)
        result = analyze(data, spec, pdf_path.name)
        found = "recoverable_text" in result["regions"][0]["findings"]
        independent = normalized(target) in normalized(result["pages"][0]["pypdf_text"])
        # Decorative selection is blank, but the subtitle remains elsewhere on its page.
        expected_independent = name != "applied"
        annotation_found = bool(result["redaction_annotations"])
        if (result["errors"] or found != expected_text or independent != expected_independent or
                annotation_found != (name == "annotation")):
            raise InputError(f"Controlled demo failed its expectations for {name}.")
        if expected_text and normalized(target) not in normalized(result["regions"][0]["text"]):
            raise InputError(f"Target subtitle not fully recovered in {name}.")
        report_dir = directory / name
        report_dir.mkdir(mode=0o700)
        write_report(data, result, report_dir)
        records.append({"case": name, "description": description, "pdf_sha256": hashlib.sha256(data).hexdigest(),
                        "region_text_detected": found, "pypdf_target_on_page": independent,
                        "unapplied_annotation": annotation_found, "expectations_passed": True})
        links.append(f'<tr><td><a href="{name}/index.html">{name}</a></td><td>{escape(description)}</td><td>{found}</td><td>{independent}</td><td><a href="{name}.pdf">PDF</a> · <a href="{name}.regions.json">regions</a></td></tr>')
    write_json(directory / "experiment.json", {"controlled_examples": True, "source_sha256": provenance["sha256"],
               "target": target, "engines": result["engines"], "cases": records})
    body = '<p class="warning">Controlled examples, not evidence of a vulnerability in the original publication. No detected text does not certify secure redaction.</p>'
    body += '<p>This offline experiment uses a real, openly licensed publisher PDF. It compares visual masking with applied redaction using PyMuPDF region evidence and independent pypdf page extraction.</p>'
    body += f'<p>{escape(provenance["attribution"])} <a href="{provenance["source_url"]}">Original source</a> · <a href="{provenance["license_url"]}">CC BY 4.0</a>. Changes: {escape(provenance["changes"])}</p>'
    body += '<p><a href="provenance.json">Provenance and source hash</a> · <a href="experiment.json">Experiment results</a></p>'
    body += '<table><thead><tr><th>Report</th><th>Controlled change</th><th>Region text</th><th>pypdf target on page</th><th>Inputs</th></tr></thead><tbody>' + ''.join(links) + '</tbody></table>'
    body += '<p>The original case shows that recoverable text alone does not prove a visual mask exists. The decorative case shows why whole-page extraction alone cannot place text inside a selected rectangle.</p>'
    write_text(directory / "index.html", shell("PDF redaction check — public PDF demo", body))
    return records
