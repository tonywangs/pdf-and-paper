# Design and prior work

Primary documentation inspected before implementation:

- [SQLite FTS5](https://www.sqlite.org/fts5.html): established full-text indexing with tokenizers, phrases, advanced query grammar, and optional trigram substring matching. FTS is appropriate for larger durable collections. This browser-only workbench instead preserves direct source offsets and a deliberately narrower grammar without SQLite/WASM runtime distribution. It does not claim FTS5-compatible tokenization.
- [Lunr search guide](https://lunrjs.com/guides/searching.html): an existing browser-search implementation with fields and richer query features. This project chooses exhaustive lexical occurrence matching rather than ranked document retrieval. It avoids stemming and reconstructing passage locations from a separate ranked index.
- [Rust Book repository](https://github.com/rust-lang/book) and its pinned `LICENSE-MIT`, `LICENSE-APACHE`, and `COPYRIGHT`: suitable openly licensed substantive text with immutable revision references. Raw source includes Markdown and code-listing directives, intentionally not rendered or expanded.

`web/engine.js` handles strict ingestion, token spans, deterministic search, manifests, snapshots, and inert reports. `web/app.js` handles DOM rendering, IndexedDB, user-triggered local demo loads, and download/import. `serve.py` is a loopback-only static launcher. The browser holds original source strings and per-line token offsets; it does not modify or upload filesystem inputs.

The independent verifier uses Python Unicode character categories and a scanning implementation rather than the application's JavaScript regular expression tokenizer. It compares complete expected occurrence tuples against the app's reports for the frozen real collection. Labeled controls cover difficult cases absent from the collection; they are not represented as real-world corpus evidence. This validates the defined bounded lexical behavior, not relevance quality, multilingual linguistic quality, or performance at arbitrary scale.

The engine and browser use the runtime's Unicode tables, which can vary between releases. The frozen corpus plus explicit Unicode controls detect tested differences; full Unicode-version conformance is outside this tool's scope. Reports carry the complete semantics text so their interpretation does not depend on recollection of defaults.
