# Matching and coverage contract (desk-v1)

| Concern | Exact behavior |
| --- | --- |
| Source | Strict UTF-8 `.txt` and `.md`, raw source; no Markdown rendering or include expansion. BOM retained. |
| Tokenization | Maximal runs of Unicode letters (`L`), combining marks (`M`), or numbers (`N`). Underscores, hyphens, apostrophes, emoji and punctuation separate tokens. |
| Normalization | Each token is NFC-normalized, then JavaScript locale-independent lowercased. Accents remain; `café` matches decomposed `café`, not `cafe`. This is lowercase matching, not full Unicode case folding: `ß` is not `ss`. |
| Whole token | One complete token, optional surrounding whitespace. `ship` does not match `ownership`. |
| Token phrase | Consecutive tokens in a single source line. Punctuation and whitespace between tokens are ignored: `compile-time` matches `compile time`. Leading/trailing punctuation in a phrase is ignored unless reserved below. |
| Literal substring | Exact, case-sensitive, normalization-sensitive character sequence within one line. Punctuation is literal. Overlapping occurrences count (`aa` occurs twice in `aaa`). |
| Query syntax | Modes selected explicitly; not inferred. Empty/whitespace-only, multiline, and >500 UTF-16-unit queries rejected. Term/phrase modes reject `" * ? : ( ) \ \| + [ ] { } ^ ~` and standalone uppercase `AND OR NOT NEAR`; choose literal mode to search these. No operators, fields, wildcard, regex, stemming, ranking or fuzzy search. |
| Lines | CRLF, bare CR, and LF each delimit a line. Phrase/literal queries never cross a line. Trailing newline leaves an empty final line. |
| Locations | 1-based line and start column; end column exclusive. Columns count UTF-16 code units in the unmodified line. Each occurrence reports the entire source line, exact matched span, filename, and source SHA-256. |
| Ordering | UTF-16 filename order, then line and start offset; no locale-dependent sorting. |
| Filtering | Exact filename, applied before matching. Exported reports state the filter. |
| Truncation | Count all matches and collect the full matching-document set; display/export first 2,000 occurrences with explicit truncation flag. Selection can include only displayed matches. |

## File outcomes and resource limits

Every submitted input yields one `indexed`, `rejected`, or `failed` record. Indexed includes empty files, which have no matches. Coverage and rejections are visible in the browser, exported projects, and reports. Reports have coverage counts plus manifest outcomes; projects additionally retain rejection reasons.

- Maximum 100 files in submitted order; later submissions are rejected individually. All occurrences of duplicate filenames are rejected, even if their content is identical. Rename duplicates before importing. Subdirectories are not inferred by a multi-file picker.
- Filename maximum 240 UTF-16 units and `.txt` or `.md` extension (case-insensitive). Empty names and other extensions are rejected.
- At most 1 MiB per file and 8 MiB cumulative attempted eligible source bytes. Rejected decoding/binary/line/token cases consume the attempted byte budget, so coverage remains bounded in submitted order.
- Maximum 20,000 UTF-16 units per line, 20,000 lines per file, 100,000 tokens per file, and 300,000 indexed tokens per collection. Reject the whole affected file, never silently truncate an index. Rejected token-count files do not consume the indexed-token budget.
- Malformed UTF-8 rejected with fatal decoding. NUL and ASCII control bytes other than tab, LF, CR rejected as binary/control content. Some binary formats can be valid text; no format guessing beyond these explicit checks.
- Read/hash failures become `failed`; malformed content or limit failures become `rejected`.
- At most 100 saved searches. Project imports and all exports limited to 32 MiB of encoded JSON/HTML. Export failure is visible; no partial download. Many saved queries with many selected occurrences can reach this cap.

## Recovery and integrity

IndexedDB stores a portable source snapshot and saved queries when a collection changes or **Save query & selection** is clicked. Source text is re-encoded and hashed during restoration. Saved searches bind to the complete coverage/source manifest, including statuses, byte lengths, and hashes. Source changes, missing files, extra files, or changed search semantics withhold saved results until explicit rebuild. Rebuild clears selections and, if its selected filename is missing, resets the filter to all files with a visible notice. Current matching results are recomputed; imported result passages are never trusted.

HTML reports are script-free and deny network resources using CSP. JSON exports are data. Imported text and filenames enter the app through DOM text nodes, not HTML. The app fetches only its local bundled demo when requested; file import, searching, restoration and reports do not make network requests. No analytics, CDN assets, third-party fonts or service worker.
