# Document Search Desk

Search a local text collection, open exact matching source lines, save queries and selected matches, and export reproducible offline evidence. Documents never leave the browser and original files are never written. No accounts, paid services, build step, or runtime dependencies.

## Launch

```sh
python3 serve.py
```

Open **http://127.0.0.1:8765** in a modern Chromium or Firefox browser. Python 3.10+ is sufficient. Keep the same hostname and port for browser recovery. The server binds only to loopback and serves only `web/`; it has no upload endpoint. Stop with Ctrl+C.

1. Click **Open real-corpus demo**. Twenty substantive, unmodified Markdown chapters from *The Rust Programming Language* load from bundled local files. The default `ownership` search has 102 occurrences in 11 documents.
2. Click any result filename to see seven source lines around the match, its line/column, and SHA-256. Markdown, including HTML and includes, is shown as inert source text.
3. Try **Token phrase** → `the stack`, or **Literal substring** → `println!`. Use the file dropdown to restrict scope.
4. Select matches and click **Save query & selection**. Reload, then click that query under **Saved desk** to recover it and its selection. Unsaved query/selection edits are not persisted.
5. Export a **project** to preserve original source text, coverage, source manifest, queries, and selections. Clear the desk and import it to recover independently of browser storage. Importing files replaces the collection but retains saved searches; changed or missing sources require an explicit **Rebuild** and clear old selections.
6. Export **HTML report** or **JSON report**. Open HTML directly from disk, even with the server stopped and network disconnected. Reports include all displayed results, selection identifiers, semantics, file filter, hashes, coverage, complete matching-document set, and visible truncation. They are snapshots, not live access to your filesystem.

You can also import your own `.txt`/`.md` files. Inspect **Coverage & source hashes** to account for every submitted file. [Sample HTML](examples/ownership.html) and [sample JSON](examples/ownership.json) are generated from the real collection; open the HTML in a browser. The server deliberately does not expose repository documentation or examples.

## Search contract

See [precise semantics and limits](docs/semantics.md). Whole-token search is distinct from literal substring search. There is no relevance model, stemming, fuzzy matching, Boolean syntax, or Markdown rendering. Results are deterministically ordered by filename, line, and offset. Phrase matching does not cross a source line. Unsupported syntax is an error, never silently interpreted as an advanced query.

## Corpus and existing work

The bundled collection contains 20 chapters, each over 7,000 bytes, from the Rust Book at revision `1500248d8f230566e4ec9f27fcbb8fe9e2898ab1`. The [manifest](web/corpus/manifest.json) records exact upstream paths, immutable URLs, sizes, and SHA-256 hashes. Both upstream license texts and copyright notice are retained under `web/corpus/`. The source is offered under MIT OR Apache-2.0; the demo includes raw Markdown only, not referenced external code listings or images. Search results refer to these exact raw files, not rendered book pages.

Reacquire the same bytes (network required):

```sh
python3 tools/acquire_corpus.py
```

The selection is the first 20 lexicographically sorted `src/ch*.md` files larger than 7,000 bytes at the pinned revision. [Design and primary sources](docs/design.md) compare SQLite FTS5 and Lunr. This project makes no novelty claim.

## Verification

Runtime needs only Python and a browser. Development verification needs Node 20+ and Python 3.10+:

```sh
npm test
```

The Node suite exercises labeled edge controls. A separate Python character-category scanner verifies all matching-document sets and every returned passage/line/UTF-16 column for [15 frozen real-corpus queries](tests/queries.json), and independently checks acquisition hashes and indexing coverage. It does not call the app tokenizer or search implementation to calculate expected matches.

To reproduce the browser workflow:

```sh
npm ci
npx playwright install chromium
npm run browser
```

On Linux, Chromium requires its normal OS libraries. Set `CHROMIUM_PATH=/path/to/chromium` to use an installed browser. The test runs its own loopback server on port 18765 and uses an isolated browser profile. It checks real-corpus import, source context, selection persistence through reload/project import, stale-source and semantic-version rebuilds, malformed/duplicate/binary coverage, inert source rendering, filtered phrase reports, offline `file://` HTML reopening, and absence of external app requests. Set `SCREENSHOT_PATH=/tmp/desk.png` for a screenshot.

Regenerate the sample reports after intentional corpus/semantics changes:

```sh
node tools/corpus_reports.mjs --examples
```

## Limitations

This is a bounded lexical workbench, not a filesystem watcher or semantic search service. Re-import sources to detect external edits; the browser cannot detect changes to files it no longer has access to. Source hashes identify bytes, not authenticity or signatures. Projects contain source text and should be shared only with appropriate recipients. Browser data may be evicted or unavailable; failures are shown, and portable project export is the backup. Only explicitly saved selections recover. Files rejected or failed during import retain metadata/reasons, not their original bytes. Indexed source text round-trips valid UTF-8, including BOM and line endings.

Search runs on the main browser thread within documented limits; it is intended for small collections. The automated browser evidence is Chromium, not a claim of tested Safari/Firefox compatibility. Exports contain at most 2,000 occurrences, with full total and document-set counts retained. Project/report downloads are limited to 32 MiB and fail visibly above that size; remove saved searches or reduce the collection. Source references use UTF-16 columns, not byte or grapheme offsets.
