# PDF Revision Desk

An offline workbench for inspecting visible changes between PDF revisions, with editable page matching and a portable HTML report.

## Launch

Install Node.js 22 or newer, then run:

```sh
./launch.sh
```

Open **http://127.0.0.1:4318**. First launch downloads locked npm dependencies; subsequent launches and all PDF processing work offline. The server binds only to loopback. It serves static assets and never receives imported PDFs. No cloud API, account, telemetry or external fonts.

Choose **Open real NIST demo**, or select two PDFs and **Compare PDFs**. Start with a highlighted correspondence, inspect the earlier/later images and pink overlay, choose a different later page if needed, and mark it reviewed. Click a page image to open its full 72-dpi rendering. **Next change / uncertainty** moves through changed or unreviewed rows. **Export standalone HTML** saves all pages, settings, source hashes and review decisions in one file that opens offline without this app.

Matching an already assigned later page releases its previous pairing and marks that earlier page unreviewed. Select **Unmatched / possible deletion** to separate a pair. Unmatched later pages appear after earlier pages and can be marked reviewed as possible insertions. The original PDFs are never modified. Recovery stores the current rendered comparison and decisions in browser IndexedDB; reload resumes it. **Forget comparison** deletes that saved state. Downloaded reports must be deleted separately.

## Real demo and provenance

The bundled, unmodified inputs are *Cloud Computing Synopsis and Recommendations*, NIST SP 800-146, **May 2011 draft → May 2012 final**. The draft archive includes two NIST historical cover sheets (86 total PDF pages); the final has 81 pages. All page references in this app use **1-based PDF positions**, not printed page labels. Printed labels are also shown where available.

[Source URLs, revision identifiers, license evidence and SHA-256 hashes](demo/provenance.json) are bundled. Each document's §1.1 states it is not subject to copyright; NIST also grants worldwide reprint and derivative permission in its [publication policy](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications). Republished courtesy of the National Institute of Standards and Technology. These are historical demo inputs, not current security advice.

Re-download and verify exact source bytes:

```sh
node scripts/fetch-demo.mjs
```

Useful starting comparisons:

- Draft PDF **3 → final 1**: cover title, removal of DRAFT, author typography.
- Draft PDF **4 → final 2**: May 2011/Gary Locke becomes May 2012/John Bryson; the director's title changes.
- Draft PDF **13 → final 11**: purpose wording changes; audience includes network administrators.
- Draft PDF **15 → final 13**: cloud-definition examples and footnotes change.
- Draft PDF **1–2** are historical archive material with no direct final equivalent.

The complete app and demo make no novelty claim. Existing [diff-pdf](https://github.com/vslavik/diff-pdf) provides visual comparison and highlighted output. This work emphasizes explicit uncertainty, manual correspondence, recovery and an inspectable standalone report. Rendering follows the [PDF.js page/canvas API](https://mozilla.github.io/pdf.js/examples/).

## What the comparison means

PDF.js 5.4.296 renders the displayed crop box at **72 dpi**, respecting intrinsic page rotation. Color is browser RGB on white. Each pixel changes if its largest absolute RGB-channel difference is **strictly greater** than the selected tolerance (default **20/255**). There is no spatial noise suppression, automatic rotation, resizing or translation alignment. Different sizes are aligned at the top left and white-padded; a size change is flagged even if its added area is white. Pink overlays indicate changes in either direction, not specifically additions or removals. Overlay backgrounds are faded later-page pixels. Unmatched pages compare against white.

Matching combines text-bigram Dice overlap (90%) and a 24×32 grayscale visual thumbnail (10%). Pages without sufficient text use only visual similarity. A pair is suggested only for mutual best candidates with score ≥0.60 and margins >0.035 in both directions. Blank or near-blank pages remain unresolved and cannot compete with nonblank pages. Scores are heuristics, **not calibrated probabilities**. Every suggestion still needs human review. Repeated text, scanned pages and heavy reflow often remain unmatched. Every earlier and later page is represented exactly once; an unmatched page can represent reflow, not necessarily a true insertion/deletion. Matching is one-to-one; one-to-many semantic alignment is unsupported.

A zero pixel count only means these rendered pixels agree at the selected tolerance. It does not establish semantic, byte, accessibility, metadata or cryptographic-signature identity. Tolerance changes reset review flags. Reports explicitly retain unreviewed and unmatched status.

## Limits and unsupported cases

- **100 pages / 16 MiB per PDF**, 2 million pixels per page, 120 million pixels across both PDFs. Checks stop over-limit input; complex PDFs may still exhaust browser memory. Large exports can be tens of MiB and require a desktop browser. No streaming or cancellation; reload abandons ongoing work and recovers the last saved comparison.
- **Encrypted PDFs are refused**, including encryption with an empty user password. Supply an authorized decrypted copy. Malformed input is rejected on parser failure; PDF.js may recover some damaged PDFs, so inspect results. A rejected import retains the prior saved comparison.
- **Annotations and forms:** PDF.js visible annotations and saved form appearances may render. The viewer does not offer form interaction, annotation editing, signature validation, PDF JavaScript, embedded files, multimedia or hidden-layer review. Appearance regeneration can differ from Acrobat.
- **Scans:** visual comparison only, no OCR. Rotation is rendered as stored and reported; it is not normalized. Different page sizes are preserved, subject to the pixel cap. Crop-box content only; material outside it is not inspected.
- **Rendering artifacts:** font substitution, antialiasing, transparency, color spaces, optional-content defaults and unsupported PDF features can produce discrepancies. 72 dpi can miss fine detail. Use the source PDFs in another viewer for high-stakes or print-quality review.
- **Privacy:** browser-local storage persists rendered document content and extracted text until forgotten or browser data is cleared. A standalone report contains all rendered pages, filenames, hashes, provenance when recognized, and decisions; it does not embed the original PDFs. Treat it as sensitive as the source documents.
- Tested in Linux Chromium. Other browsers and physical printing are not verified. The local application requires a modern browser with workers, canvas, IndexedDB and Web Crypto.

## Reproduce validation

```sh
npm ci --cache /tmp/pdf-revision-npm --no-audit --no-fund
npx playwright install chromium
npm test
npm run fixtures
npm run test:browser
npm run verify:oracle
node tests/recovery.mjs
node scripts/verify-real-matches.mjs
node scripts/check-package.mjs
```

For a custom browser installation set `PLAYWRIGHT_BROWSERS_PATH`. Browser tests start their own ephemeral loopback server and use real file pickers, correction controls, reload, and HTML downloads. They check every exported source image byte-for-byte against the reviewed rendering and every page reference against the saved comparison. Intermediate renders and large reports are written to `/tmp/pdf-revision-artifacts`; bounded evidence goes in `results/`. These are reproducible test results, not private planning or acceptance records.

The separate MuPDF renderer checks representative genuine differences and injected text, embedded-image, insertion/deletion, rotation, size, duplicate and blank cases. `tests/fixtures/expected.json` labels all injected changes. MuPDF is a **development-only** AGPL dependency, not served to the application; PDF.js is Apache-2.0. The check uses an independent pixel routine and allows renderer antialiasing differences; it is not exhaustive semantic validation.

## Inspect the evidence

[Browser screenshot](results/demo-browser.png) · [Browser workflow checks](results/browser-checks.json) · [Launch/recovery checks](results/recovery-checks.json) · [Independent renderer and exact overlay checks](results/oracle-checks.json) · [Independent title-page render](results/independent-title-pages.png).

The real standalone export is approximately **33 MiB** and is generated locally at `/tmp/pdf-revision-artifacts/real-report.html` by the browser test, or downloaded through the app. It is excluded from the repository's 10 MiB per-file budget. The test checks all 167 source page references; the independent overlay audit checks 92 real and 13 controlled correspondence rows. These are saved review decisions, not a claim that every real pair has been manually reviewed.

**Negative renderer result:** the two draft body-page samples did not pass provisional cross-renderer pixel-agreement thresholds (raw RMSE <25/255 and 2×2 block-average RMSE <12/255). Measured raw RMSE was 26.433 and 28.807; block-average RMSE was 14.666 and 16.000. PDF.js draft glyphs look more speckled than MuPDF, although inspected content and layout match. Thresholds were not raised. These metrics remain failed diagnostics; real change verification uses independent text and visual inspection, not a claim of pixel equivalence between renderers. Exact exported overlays/counts are checked against their actual PDF.js source renders. All controlled render comparisons passed the raw threshold.
