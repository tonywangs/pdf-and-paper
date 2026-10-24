# Marginalia

Document assembly, comparison, extraction, and review.


Independent utilities collected into one private repository. Each lives under `tools/<name>/`; run its installation and commands from that directory. This is a source consolidation, not a unified application.

Original repositories and server workspaces were retained. Original histories are reachable through merge commits and `history/` tags. Unpublished source was copied from the server; it may be incomplete.

- [pdf-redaction-check](tools/pdf-redaction-check/README.md): An offline CLI that checks specified PDF redaction regions for recoverable text and produces a visual, evidence-linked inspection report.
- [booklet-fold-preview](tools/booklet-fold-preview/README.md): An offline PDF booklet maker with a visual folding preview, printable sheet output, and explicit page-order verification.
- [scan-proof-desk](tools/scan-proof-desk/README.md): A local OCR proofreading application that links editable text to scanned page regions and exports corrected, source-linked transcriptions.
- [pdf-revision-desk](tools/pdf-revision-desk/README.md): An offline PDF revision viewer with inspectable page matching, side-by-side previews, and visual change overlays.
- [pdf-page-assembly-desk](tools/pdf-page-assembly-desk/README.md): A local PDF workbench for selecting, reordering, rotating, and combining pages into a new document with traceable source references.
- [pdf-table-review-desk](tools/pdf-table-review-desk/README.md): A local workbench for extracting tables from text-based PDFs, checking cells against source regions, correcting errors, and exporting traceable CSV files.
- [epub-assembly-desk](tools/epub-assembly-desk/README.md): A local workbench for arranging Markdown chapters, previewing a book, and exporting a validated EPUB with preserved images and navigation.
- [document-search-desk](tools/document-search-desk/README.md): A local document-search workbench with source-linked matches, inspectable indexing coverage, saved searches, and portable offline reports.
