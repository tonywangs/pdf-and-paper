# Dependency and scope decisions

Primary documentation inspected before dependency selection:

- [pdfplumber README](https://github.com/jsvine/pdfplumber/blob/4c64b92d5caccd71c645e98e0fabb0c4dba7ff45/README.md): exposes word/character positions and crop geometry; describes limitations on scanned PDFs and multiple table strategies.
- [Tabula](https://tabula.technology/): already provides local visual region selection and CSV extraction for text-based PDFs.
- [BLS copyright policy](https://www.bls.gov/bls/linksite.htm): initially considered archived BLS reports, but direct PDF acquisition returned HTTP 403. No BLS fixture or result is claimed.
- [USDA public-domain policy](https://www.nal.usda.gov/programs/speccoll) and [FBI information reuse policy](https://www.fbi.gov/privacy-policy) support the selected federal data fixtures; evidence is retained in fixtures/sources.json.

This application does not claim a novel extraction algorithm. It uses pdfplumber
(MIT) word positions, PDFium via pypdfium2 (permissive PDFium/BSD/Apache notices
in the dependency distribution) for rendering, pypdf (BSD) to reject encryption,
and Flask (BSD) for a loopback-only interface. Dependencies are pinned.

Users choose explicit column boundaries. Single-line mode groups word tops with
a configurable tolerance; multiline mode requires explicit row boundaries and
joins distinct lines using LF within the cell. Original suggestions are immutable.
A replayable event list constructs current values, review flags, and structural
changes. Undo restores the prior grid and is itself retained as an event.
Deletion events retain removed values; the original and all earlier actions also
remain in project files and export manifests. Stable cell IDs and original source
bounds follow cells when reordered. Inserted cells have no source region.

Projects are browser-local JSON and PDFs are in `.data/` keyed by SHA-256. Source
reconnection rejects different bytes. Import and export regenerate the original
extraction from source/settings to detect altered originals and incompatible
extractor versions. Offline project inspection preserves data, but export requires
a matching PDF. Review history is transparent, not a cryptographic attestation of
who reviewed it: someone with access to a JSON file can edit its events.

Scans, encryption, rotated pages/text, declared merged cells, and multipage
layouts are rejected explicitly. Separators crossing words are rejected. Detection
of all semantic merged cells is not possible from word geometry: users must select
the merged layout option when present or crop a simple subtable. Multipage tables
can be extracted as separate regions but are not stitched automatically. No OCR,
remote inference, accounts, or paid compute is used.
