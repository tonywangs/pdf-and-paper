# Real-document fixtures and reference

These are real federal reports, acquired from the immutable pdfplumber revision in
[sources.json](sources.json). That file records publisher URLs, mirror URLs,
revision, retrieval time, PDF metadata, byte hashes, and public-domain evidence.
The USDA report is dated 2017-02-24; the FBI document is an archived one-page
extract for November 2015. No publisher endorsement is implied. The license of
pdfplumber's code is not being used as a substitute for document rights.

Reacquire the pinned bytes with ` .venv/bin/python scripts/acquire.py `.
The script refuses changed hashes. The original publisher URLs may now serve
newer reports; the immutable mirror is the reproducible acquisition source.

## Reference protocol

The implementing agent visually transcribed three selected table bodies from
PDFium-rendered images before running table extraction. `reference.json` and its
SHA-256 preserve that first freeze. An independent agent then visually checked
all 260 cells directly from fresh PDF renders, without using extraction output.
This is manual visual agent transcription, **not human-certified transcription**.

The preliminary extraction comparison prompted a reference audit. That audit
found four transcription errors in the first freeze:

| NICS cell | v1 | Corrected visible source in v2 |
|---|---|---|
| California / Permit | `98,452` | `98 452` |
| California / Handgun | `41,181` | `41 181` |
| California / Long Gun | `35,007` | `35 007` |
| Ohio / Long Gun | `13,871` | `31,817` |

California visibly uses a gap rather than a comma; the transcription represents
that gap as ASCII space. Image inspection cannot establish the underlying Unicode
character. The corrected, separately hashed `reference-v2.json` is the evaluation
reference. It was frozen **after preliminary evaluation**, not retrospectively
claimed to be the original freeze. All 256 other cells and all ordering matched
in independent visual review. Both versions remain available.

The USDA ethanol body has six rows, with the report-link column excluded. Biomass
has three rows and four columns. FBI NICS includes all 55 jurisdictions plus the
total, restricted to the first four columns. Headings/units are stored as metadata,
not CSV rows. These selected regions do not benchmark entire documents or omitted
columns. NICS counts are background checks, not firearm sales.

`presets.json` stores region coordinates and extraction settings separately from
the reference. Evaluation compares exact strings: differences in spacing and
punctuation count as errors even where numerical meaning is unchanged. No
extraction confidence score is presented as accuracy.
