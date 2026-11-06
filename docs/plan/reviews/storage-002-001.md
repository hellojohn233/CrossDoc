# Review: storage-002

## Findings

- **P1 · resolved** — The Library listed one row per upload, so repeated reviews of three contracts produced thirty-three rows for three documents. The list is now grouped by content: one row per document, with the copies folded underneath.
- **P1 · resolved** — Uploading the same file twice overwrote the existing row's `uploaded_at` and title. Every upload now mints a fresh id and produces its own archive, and the upsert no longer overwrites `uploaded_at`, `title`, or `source_name`.
- **P1 · resolved** — "When was this archived" and "when was this last used" were the same column, so a from-Library review reordered the whole Library. Schema v3 adds `last_used_at`; `uploaded_at` is written once and never moves, and `last_used_at` moves on every archive or review.
- **P1 · resolved** — The v2→v3 migration assumed a `documents` table exists. A database that only ever held settings has none, and the migration now checks `sqlite_master` first and skips the DDL when there is nothing to split.
- **P2 · resolved** — A user uploading a document they had already archived got no signal. Both upload routes compute the content hash, look it up, and report `duplicateOf` with the existing document's title and date. The reading list says the content is already there *and* that a new archive will be saved.
- **P2 · resolved** — Two identical files in one selection ran the model twice over identical bytes, which also made the document conflict with itself. Within one selection identical content is now one document; in `/api/read` the dropped file stays visible as a per-file failure, and in `/api/review` a selection that collapses to nothing is a 400.
- **P2 · accepted** — The content hash is an index and not a unique constraint. Paperless-ngx, the largest precedent at 40k+ stars, keeps `checksum` indexed-only, stopped rejecting duplicates in v3, and offers a Duplicates tab, a Duplicates filter, and `has_duplicates=true`. Papermerge, Mayan, and SeedDMS all keep every upload as a new version. CrossDoc follows: mark, do not merge and do not delete.
- **P2 · accepted** — Copy rows carry no review checkbox. They are the same content, so a checkbox on one could only ever mean "the same thing", and offering it would misrepresent the choice being made. The primary row — the oldest copy, which the references point at — is the pickable one.
- **P2 · accepted** — The title is preserved when the same content arrives under a new name. A document's name is part of its identity, and the first name is the one the user gave it. This decision was made on the user's behalf; it is the cheapest of the decisions here to reverse.
- **P2 · accepted** — The approach does not reclaim disk space. Every upload is still stored as its own archive. Marking and folding make the list readable; deleting the copies would need a destructive operation the user asks for by name, and Paperless-ngx's own answer to that is a separate `merge_as_versions` endpoint.
- **P3 · accepted** — Only exact content matches are detected. A PDF that is the same contract with one changed page has a different hash and stays a separate document. Near-duplicate detection (MinHash/LSH, as `paperless-ngx-dedupe` does it) is a different piece of work.

## Verification

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run verify:library-groups` passed with twelve checks: grouping by content, distinct content kept apart, a document without a hash standing alone, the oldest copy being the primary, an empty library rendering cleanly, duplicate counts ignoring unhashed documents, the notice naming the repeated groups, copies collapsed by default with only the primary pickable, the picked state following the selection, HTML escaping of titles, the empty state, and the two timestamps being shown separately.
- `npm run verify:library-identity` passed with nine checks: two uploads of one file both archived, equal content sharing a hash, the upload telling the user the content is already in the library, one selection of two identical files counting once with the other visible as a failure, distinct content archived separately, a document being found by content, a from-Library review leaving `uploaded_at` alone while refreshing `last_used_at`, an old database gaining `last_used_at` on upgrade, and the list folding one content group into one row.
- The full suite passed: `verify:skills` (13), `verify:review-semantics` (17), `verify:review-library` (8), `verify:web-read`, `verify:storage`, `verify:conflict-diff` (11), `verify:document-ingest`, `verify:document-search`, `verify:scan-page-blocks`, `verify:pdf-page-render`, `verify:pdf-vector-classification`, `verify:agent`, `verify:agent-parallel`.
- Browser walkthrough on the running server: the Library shows `3 组内容相同，共 30 份归档。展开可以看到每一次归档。` above three rows (`contract-a`, `contract-c`, `contract-b`, each `PDF · 1 页 · 2026/10/27`), each with `另有 9 份相同内容 ▾`. Expanding a group switches the control to `收起相同内容 ▴` and reveals the copies with their own dates (`2026/11/4` among them).

## Conclusion

**pass** — a document is now identified by its content rather than by how many times it arrived, the Library reads as a list of documents, both timestamps say what they mean, and the user is told when the content they are uploading is already there.
