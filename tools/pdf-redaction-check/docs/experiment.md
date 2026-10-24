# Controlled public-PDF experiment

Input: the unmodified, 25-page publisher sample of *Creative Commons for Educators
and Librarians*, Creative Commons, ALA, 2020. Downloaded 2026-10-19 from the URL
and pinned SHA-256 in [provenance.json](../src/pdf_redaction_check/data/provenance.json).
Its second page contains the CC BY 4.0 license and third-party notices. The demo
uses only its title page, targeting the subtitle “for Educators and Librarians”.
The bundled source is about 957 KiB; no account, paid data or inference is needed.

Run `pdf-redaction-check demo --out NEW_DIRECTORY`. The source hash is checked
before any variants are generated. There is no random sampling or random seed.
Each variant extracts source PDF page 1; the transformations below are performed
by the pinned PyMuPDF 1.26.7. The saved file is reopened for inspection and pypdf
6.1.3 independently extracts its text. Results include source/variant hashes,
versions, rectangles, HTML previews, JSON findings and complete page extractions.

Observed results from the included run:

| Controlled variant | Region text found | Target in independent page extraction | Unapplied annotation |
| --- | --- | --- | --- |
| Original title page | Yes | Yes | No |
| Black visual mask | Yes | Yes | No |
| Applied redaction, full save with garbage collection | No | No | No |
| Unapplied redaction annotation | Yes | Yes | Yes |
| Masked page rotated 90° | Yes | Yes | No |
| Selected decorative rectangle in blank margin | No | Yes, elsewhere on page | No |

All six expectations passed. These are controlled examples on real public
material, not a representative benchmark or a discovery of a leak in the source.
The original case also demonstrates that recoverable text does not establish
that there is a mask. The decorative case demonstrates why page text alone cannot
prove that text occupies a region. Applied redaction is a control for extraction
of the target, not proof that the entire PDF is secure.

## Negative result: neighboring glyph boxes

The first experiment used the subtitle's full search rectangle with a one-point
margin. Applied redaction removed the subtitle, but the checker still reported
`COMMONS` from the heading above. Its tall font bounding box overlaps that expanded
region although the heading's visible ink is above it. The independent extractor
confirmed that the heading remained. This is a limitation of conservative box
intersection, not evidence that the subtitle survived.

The final experiment starts five points inside the subtitle's search box to
isolate it from the neighboring heading, while still intersecting every subtitle
glyph. A regression test preserves the expanded-region result. Users should use
the report to judge such nearby-text findings; tightening a region is appropriate
only when it still covers the intended sensitive content.

## Other validation

The focused suite tests the public demo and synthetic geometric boundary cases:
all four page rotations, cropped/rotated pages, tiny partial overlaps versus
edge-only contact, applied controls, unapplied annotations on unselected pages,
decorative rectangles, raster-image warnings, invalid regions, password-protected
inputs, independent parser failures, HTML escaping, preservation of input bytes,
output collision handling and the actual CLI exit codes. Synthetic fixtures test
geometry; they do not substitute for the public-PDF workflow above.

Additional executed checks: an sdist and wheel built successfully; the installed
wheel ran the bundled demo outside the source checkout using system Python.
Chromium exercised rotated-page selection, JSON download, recovery from that
selection, the report's evidence link, image loading and a 390-pixel viewport.
It observed no remote requests or JavaScript errors. These are local Linux checks;
other operating systems and browsers have not been exercised.

To repeat packaging isolation, run `python3 -m build` followed by
`python3 tests/wheel_smoke.py`. The latter installs the wheel and its dependencies
into a temporary directory, then disables site-packages for the demo subprocess.
It needs package-index access for installation; the demo itself remains offline.

Optional browser smoke check (not a runtime dependency):

```sh
python3 -m pip install playwright==1.55.0
python3 -m playwright install chromium
python3 tests/browser_smoke.py
```

The browser check creates temporary fixtures, opens local files, and writes
screenshots to `/tmp/pdf-check-report-desktop.png` and
`/tmp/pdf-check-report-mobile.png` for inspection.
