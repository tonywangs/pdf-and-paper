import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pymupdf as fitz
import pytest

from pdf_redaction_check import core
from pdf_redaction_check.core import COORDINATES, InputError, analyze
from pdf_redaction_check.demo import run_demo
from pdf_redaction_check.report import output_directory, prepare, write_report


def spec(rect, page=1, name="secret"):
    return {"coordinate_system": COORDINATES, "regions": [{"id": name, "page": page, "rect": list(rect)}]}


def fixture_pdf(mode="masked", rotation=0, cropped=False):
    doc = fitz.open()
    page = doc.new_page(width=400, height=300)
    page.insert_text((80, 100), "SENSITIVE VALUE", fontsize=16)
    page.insert_text((80, 180), "Public footer", fontsize=12)
    if cropped:
        page.set_cropbox(fitz.Rect(40, 30, 360, 270))
    box = page.search_for("SENSITIVE VALUE")[0]
    if mode == "masked":
        page.draw_rect(box, fill=(0, 0, 0), color=(0, 0, 0))
    elif mode in ("applied", "annotation"):
        page.add_redact_annot(box, fill=(0, 0, 0))
        if mode == "applied":
            page.apply_redactions()
    page.set_rotation(rotation)
    displayed = box * page.rotation_matrix
    data = doc.tobytes(garbage=4)
    doc.close()
    return data, spec(displayed)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("cropped", [False, True])
def test_masks_rotation_and_crop(rotation, cropped):
    data, regions = fixture_pdf(rotation=rotation, cropped=cropped)
    result = analyze(data, regions)
    assert result["exit_code"] == 1
    assert result["regions"][0]["text"] == "SENSITIVE VALUE"
    assert result["regions"][0]["independent_check"]["status"] == "all_fragments_found_on_page"
    assert result["pages"][0]["rotation"] == rotation


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_applied_control(rotation):
    data, regions = fixture_pdf("applied", rotation)
    result = analyze(data, regions)
    assert result["exit_code"] == 0
    assert result["regions"][0]["text"] == ""
    assert not result["redaction_annotations"]
    assert "SENSITIVE" not in result["pages"][0]["pypdf_text"]
    assert "Public footer" in result["pages"][0]["pypdf_text"]
    assert "not_certified" in result["outcome"]


def test_annotation_on_unselected_page():
    data, regions = fixture_pdf("annotation", 90)
    doc = fitz.open(stream=data, filetype="pdf")
    doc.new_page(width=400, height=300)
    result = analyze(doc.tobytes(), spec([10, 10, 30, 30], page=2))
    assert result["exit_code"] == 1
    assert result["redaction_annotations"][0]["page"] == 1
    assert result["redaction_annotations"][0]["rect"] == regions["regions"][0]["rect"]
    assert {p["page"] for p in result["pages"]} == {1, 2}


def test_partial_glyph_overlap_and_boundary():
    data, _ = fixture_pdf("original")
    doc = fitz.open(stream=data, filetype="pdf")
    char = doc[0].get_text("rawdict")["blocks"][0]["lines"][0]["spans"][0]["chars"][0]
    x0, y0, x1, y1 = char["bbox"]
    result = analyze(data, spec([x0 - 2, y0 + 1, x0 + 0.01, y1 - 1]))
    assert result["regions"][0]["text"] == "S"
    result = analyze(data, spec([x0 - 2, y0 + 1, x0, y1 - 1]))
    assert result["regions"][0]["text"] == ""


def test_decorative_rectangle_is_not_auto_redaction():
    data, _ = fixture_pdf("original")
    doc = fitz.open(stream=data, filetype="pdf")
    box = fitz.Rect(10, 10, 60, 30)
    doc[0].draw_rect(box, fill=(0, 0, 0))
    result = analyze(doc.tobytes(), spec(box))
    assert result["exit_code"] == 0
    assert result["redaction_annotations"] == []
    assert "SENSITIVE" in result["pages"][0]["pypdf_text"]


def test_images_flagged_unsupported():
    doc = fitz.open()
    page = doc.new_page()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), False)
    pix.clear_with(0)
    page.insert_image(fitz.Rect(10, 10, 100, 100), pixmap=pix)
    result = analyze(doc.tobytes(), spec([20, 20, 50, 50]))
    assert "unsupported_image_content" in result["regions"][0]["findings"]
    assert result["regions"][0]["overlapping_images"] == 1
    assert result["outcome"] == "no_text_detected_not_certified"


@pytest.mark.parametrize("bad", [
    {}, {"coordinate_system": COORDINATES, "regions": []},
    spec([0, 0, 10, 10], page=0), spec([0, 0, 10, 10], page=True),
    spec([0, 0, 10, 10], page=2), spec([10, 10, 0, 0]),
    spec([-1, 0, 20, 20]), spec([0, 0, float("nan"), 20]),
    spec([0, 0, float("inf"), 20]), spec([0, 0, True, 20]),
])
def test_invalid_regions(bad):
    data, _ = fixture_pdf()
    with pytest.raises(InputError):
        analyze(data, bad)


def test_duplicate_ids_rejected():
    data, regions = fixture_pdf()
    regions["regions"] *= 2
    with pytest.raises(InputError, match="unique"):
        analyze(data, regions)


def test_independent_failure_is_not_success(monkeypatch):
    data, regions = fixture_pdf("applied")
    def broken(*args, **kwargs):
        raise ValueError("simulated parser failure")
    monkeypatch.setattr(core.pypdf, "PdfReader", broken)
    result = analyze(data, regions)
    assert result["exit_code"] == 2
    assert result["checks_incomplete"]
    assert result["regions"][0]["independent_check"]["status"] == "unavailable"


def test_html_evidence_escapes_and_never_changes_input(tmp_path):
    data, regions = fixture_pdf()
    regions["regions"][0]["id"] = '<script>alert("bad")</script>'
    pdf = tmp_path / "input.pdf"
    pdf.write_bytes(data)
    before = hashlib.sha256(pdf.read_bytes()).hexdigest()
    result = analyze(pdf.read_bytes(), regions, '<img src=x onerror=alert(1)>.pdf')
    with output_directory(tmp_path / "report") as directory:
        write_report(data, result, directory)
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == before
    text = (tmp_path / "report/index.html").read_text()
    assert '<script>alert' not in text
    assert '&lt;script&gt;' in text
    assert 'href="#region-1"' in text
    assert 'page-1.png' in text
    assert (tmp_path / "report/page-1.png").read_bytes().startswith(b'\x89PNG')
    assert json.loads((tmp_path / "report/report.json").read_text())["input"]["sha256"] == before
    with pytest.raises(InputError, match="exists"):
        with output_directory(tmp_path / "report"):
            pass


def test_invalid_pdf_and_encryption():
    with pytest.raises(InputError):
        analyze(b"not a PDF", spec([1, 1, 2, 2]))
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    with pytest.raises(InputError, match="unencrypted"):
        analyze(data, spec([1, 1, 2, 2]))


def test_prepare_and_atomic_failure(tmp_path):
    data, _ = fixture_pdf(rotation=90)
    with output_directory(tmp_path / "picker") as directory:
        prepare(data, directory, [1])
    html = (tmp_path / "picker/index.html").read_text()
    assert 'data-width="300.0"' in html
    assert 'data-height="400.0"' in html
    assert "Download regions.json" in html
    with pytest.raises(InputError):
        with output_directory(tmp_path / "bad") as directory:
            prepare(data, directory, [2])
    assert not (tmp_path / "bad").exists()


def test_public_pdf_complete_demo(tmp_path):
    records = run_demo(tmp_path)
    assert len(records) == 6
    assert all(r["expectations_passed"] for r in records)
    for r in records:
        assert (tmp_path / r["case"] / "index.html").is_file()
    # This negative demonstrates the documented bounding-box approximation:
    # the neighboring large title's bbox extends into an expanded subtitle region.
    source = Path(__file__).parents[1] / "src/pdf_redaction_check/data/cc-book-sample.pdf"
    with fitz.open(source) as doc:
        expanded = doc[0].search_for("for Educators and Librarians")[0] + (-1, -1, 1, 1)
    applied = (tmp_path / "applied.pdf").read_bytes()
    result = analyze(applied, spec(expanded))
    assert result["regions"][0]["text"] == "COMMONS"
    assert "for Educators and Librarians" not in result["pages"][0]["pypdf_text"]


@pytest.mark.parametrize("mode,code", [("masked", 1), ("applied", 0), ("annotation", 1)])
def test_cli_core_use_case(tmp_path, mode, code):
    data, regions = fixture_pdf(mode)
    pdf = tmp_path / "input.pdf"
    pdf.write_bytes(data)
    region_file = tmp_path / "regions.json"
    region_file.write_text(json.dumps(regions))
    out = tmp_path / "out"
    process = subprocess.run([sys.executable, "-m", "pdf_redaction_check.cli", "check", str(pdf),
                              "--regions", str(region_file), "--out", str(out)], capture_output=True, text=True)
    assert process.returncode == code, process.stderr
    assert (out / "index.html").is_file()
    assert pdf.read_bytes() == data
