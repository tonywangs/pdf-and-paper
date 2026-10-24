# PDF redaction check

Find text that remains recoverable inside **intended PDF redaction regions**.
The offline CLI produces a local HTML report with page previews, linked region
findings, glyph coordinates, and independent pypdf extraction evidence. It also
reports unapplied redaction annotations, including on pages outside your selection.
It never rewrites the input PDF.

**No detected text does not certify secure redaction.** This is an inspection aid,
not a sanitizer, forensic certification, or automatic detector of every black box.
Reports can expose sensitive text and page images: keep them as private as the input.

## Install and see it work

Requires Python 3.10+ with pip. From this checkout, install with one command
(preferably inside your usual virtual environment):

```sh
python3 -m pip install .
```

Then run the bundled public-PDF experiment; it needs no network or credentials:

```sh
pdf-redaction-check demo --out demo-output
```

Open the printed `file://` URL to `demo-output/index.html`. No web server is needed.
Use a fresh output path for each run. A pre-generated, inspectable demo is also
included at [results/demo/index.html](results/demo/index.html), with PDFs, region
JSON, reports and experiment evidence. Download/open it locally to view the HTML.

The source is the real publisher sample of *Creative Commons for Educators and
Librarians* (Creative Commons, ALA, 2020), licensed CC BY 4.0 except where noted.
The bundled original retains the license notices. The demo extracts its title
page and makes **controlled examples**: visible text, visual masking, applied
redaction, an unapplied annotation, a rotated mask, and a decorative rectangle.
These are not vulnerabilities discovered in the publication.
[Attribution](src/pdf_redaction_check/data/ATTRIBUTION.md) ·
[Source and pinned SHA-256](src/pdf_redaction_check/data/provenance.json).

## Check your own PDF

1. Create a local visual region picker (omit `--pages` to preview every page):

   ```sh
   pdf-redaction-check prepare document.pdf --pages 1 3 --out picker
   ```

2. Open `picker/index.html`, drag rectangles over intended redactions, and click
   **Download regions.json**. Save that JSON in your working directory.

3. Inspect those regions:

   ```sh
   pdf-redaction-check check document.pdf --regions regions.json --out inspection
   ```

4. Open `inspection/index.html`. Orange boxes link to recovered text; purple
   outlines mark unapplied annotations. Expand the independent extraction for
   whole-page evidence, and inspect the limitations and errors. `report.json`
   includes input SHA-256, engine versions, glyph boxes, findings and errors.

The picker requires pointer input. Alternatively, write the JSON directly:

```json
{
  "coordinate_system": "displayed-page-points-top-left",
  "regions": [
    {"id": "name", "page": 1, "rect": [80, 90, 240, 115]}
  ]
}
```

Pages are **1-based**. Rectangles are `[left, top, right, bottom]` in PDF points
(72 points/inch), measured from the top-left of the **displayed crop page after
page rotation**, not from the bottom-left of an unrotated media box. The picker
handles that conversion. Regions must have positive area and fit on the page.
The coordinates refer to the supplied PDF; regenerate them if its layout changes.

Exit codes for `check`:

| Code | Meaning |
| --- | --- |
| 0 | Checks ran; no region text or unapplied redaction marker detected. **Not a security certificate.** Unsupported checks still apply. |
| 1 | Recoverable region text and/or an unapplied redaction annotation found. |
| 2 | Invalid input, output failure, or incomplete parser checks. Inspect errors; do not interpret as clean. |

`demo` exits 0 when all six controlled expectations hold; it intentionally
contains individual reports with positive findings. `prepare` exits 0 on success.
Existing output paths are refused to protect inputs and earlier reports.

## Interpretation and limits

- Any positive-area glyph-box overlap counts, even if only part of a character
  intersects the intended region. This can flag adjacent visible text whose font
  box extends beyond its ink. Inspect the preview and glyph evidence before
  interpreting a finding as a failed mask. White-space-only intersections do not
  count as recoverable text.
- The checker does not infer whether a rectangle is a redaction. Visible text in
  a selected area is reported too. Ordinary decorative rectangles elsewhere
  do not generate findings automatically.
- pypdf is an independent extraction engine, but its evidence is **whole-page**.
  Fragment matches do not independently establish location and repeated text can
  match elsewhere. Disagreement is visible, never used to suppress a PyMuPDF hit.
- Images, OCR, image masks and vector outlines are not decoded for hidden text.
  Intersecting raster images are flagged, but absence of an image flag is not a
  completeness guarantee. No text on a scanned page does not imply safe redaction.
- Attachments, historical/incremental revisions, unused objects, metadata, form
  values, scripts, other annotation payloads, hidden-layer variants, font encoding
  failures and inference attacks are not exhaustively checked. Applied-redaction
  controls demonstrate current text extraction behavior, not whole-file secrecy.
- Password-protected PDFs requiring authentication are unsupported. Damaged files
  repaired by the parser are marked incomplete. Parser errors cannot produce an
  unqualified successful check. Large or hostile PDFs can consume substantial
  memory/CPU; preview dimensions are bounded, but parsing is not sandboxed.
- Installation downloads dependencies; **checking, picking and the bundled demo
  are offline**. No remote assets or telemetry are used in reports. External
  attribution links in the demo open only if you follow them.

## Reproduce development checks

```sh
python3 -m pip install '.[test]'
python3 -m pytest -q
python3 -m build
```

[Experiment methodology and observed results](docs/experiment.md) describe the
public input, controls and the bounding-box negative result.
[Implementation and related work](docs/design.md) explain the scope.

Code is [AGPL-3.0-or-later](LICENSE), compatible with the PyMuPDF dependency's
open-source license. The public PDF and derived demo material retain their
separate CC BY 4.0 terms and attribution; no endorsement is implied.
