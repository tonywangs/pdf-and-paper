# Implementation and existing work

This project claims no new redaction-detection algorithm. It packages a narrow,
explicit-region workflow with local visual evidence and independent page text.
Existing implementations include [Free Law Project X-Ray](https://github.com/freelawproject/x-ray),
which detects potential bad redactions, and
[dochush/pdf-redaction-checker](https://github.com/dochush/pdf-redaction-checker),
which provides a browser-based inspection workflow. They are relevant prior work,
not dependencies or comparative benchmarks for this implementation.

Primary technical references consulted on 2026-10-19:

- [PyMuPDF Page API](https://pymupdf.readthedocs.io/en/latest/page.html): marking a
  redaction and applying it are separate operations; extraction coordinates use
  unrotated page space and `rotation_matrix` converts to displayed page space.
- [PyMuPDF text recipes](https://pymupdf.readthedocs.io/en/latest/recipes-text.html):
  text geometry and extraction behavior.
- [pypdf text extraction documentation](https://pypdf.readthedocs.io/en/stable/user/extract-text.html):
  extraction limitations, especially image-only text and coordinate complexity.
- [The publisher's public PDF](https://alastore.ala.org/sites/default/files/book_samples/9780838919460_sample_0.pdf):
  the second PDF page supplies the explicit CC BY license and attribution.

## Evidence model

Read the input bytes once, hash them, and open both parsers from memory. PyMuPDF
raw character boxes are transformed by the page rotation matrix. Selection uses
strict positive-area box intersection instead of clipped word extraction, which
could miss partially covered glyphs. Glyphs are grouped by extracted line, not
claimed to be logical reading order. Annotations are scanned on all pages. Page
images are rendered from the unchanged bytes with annotations visible.

pypdf independently extracts the full text of each inspected page. Whitespace-
normalized fragment matches are diagnostic evidence only: no independent spatial
agreement is claimed. The full page extraction remains available for manual
comparison. Empty primary extraction is never labeled secure. Exceptions in
annotation inspection, text extraction, independent extraction or image inventory
produce incomplete checks and exit code 2. The always-present unsupported list
covers areas outside the implementation even when no exception occurs.

The HTML has no remote assets. Text is escaped; IDs and asset paths are generated
rather than derived from input text. The report is built in a temporary sibling
directory before publication to a new destination. The input is never saved.
The CLI has no network client. The picker runs local JavaScript only to create
rectangle JSON; it does not inspect the source PDF itself.

Schema version 1 is a JSON object containing `input`, `coordinate_system`,
`engines`, `regions`, `redaction_annotations`, `pages`, `limitations`, `errors`,
`outcome`, `checks_incomplete`, and `exit_code`. The `pages` collection covers
selected pages and pages with redaction annotations; text extraction is not a
whole-document content audit. Region `characters` include each recovered glyph's
text, displayed rectangle and original extracted block/line pair.
