---
id: storage-002
scope: content-identity
depends_on: [storage-001, ui-003]
status: done
---

# storage-002: Give a document an identity of its own

## Objective

Make the library answer two questions correctly: *how many documents do I have*, and *how many times did I upload them*. A document's identity is its content. Every upload is still kept, marked, and folded into one row so the list reads as a list of documents instead of a list of uploads.

## Context

`ui-003` closed the review desk gaps and left one hole in plain sight. The Library listed one row per archived document, and the review desk's own follow-up noted it: repeated reviews of the same three contracts had piled up thirty-three rows. Thirty-three rows for three documents is a list that has stopped describing anything.

The cause was a decision made earlier and never examined. When `POST /api/read` and `POST /api/review` received an upload, they derived the library identity from the file's content hash and reused it. The second upload of a contract landed on the first upload's row. That looks like de-duplication and is not: the row's `uploaded_at` was overwritten on every reuse, so the Library's ordering could not tell "just uploaded" from "just reviewed", and the archive on disk accumulated a new directory per run anyway. The index said one document; the disk said thirty.

Three things were tangled together, and they needed to be pulled apart separately.

- **What is a document.** Its content. Two uploads of the same bytes are two archived copies of one document.
- **What is an archive.** One arrival. It has a time of arrival and it never stops existing.
- **What is "recent".** Not the same question as "when did this arrive". A document reviewed yesterday was not archived yesterday.

## Decision

### The content hash is an index, not a constraint

The precedent is unambiguous. Paperless-ngx — 40,000+ stars — stores `checksum` as a `CharField(max_length=64, db_index=True)`: **indexed, not unique**. Since v3 it does not reject duplicates by default. It consumes the document, marks it, and offers a `Duplicates` tab on the document page, a `Duplicates` filter on the list, and a `has_duplicates=true` query parameter on the API. An optional `PAPERLESS_CONSUMER_DELETE_DUPLICATES=true` restores the rejecting behavior for anyone who wants it.

Papermerge, Mayan, and SeedDMS all follow the same shape: each upload produces a new version, and nothing is destroyed. `paperless-ngx-dedupe` goes further and uses MinHash/LSH for near-duplicate detection with a side-by-side human review, because "this looks the same" is a judgment, not a hash comparison.

So CrossDoc marks. It does not merge, does not reject, and does not delete. The hash is used to answer "have I seen this content before", which is a question the user deserves an answer to before they upload it a second time.

### Every upload is a new archive

Both upload routes now mint a fresh UUID per file. The library keeps what it received. A second upload of the same contract produces a second archived document, and the two are marked as sharing content.

What *did* change is the index write. `saveDocument()` upserts on the document id, and its `ON CONFLICT` clause now updates `format`, `pages`, `file_size`, `sha256`, the paths, and `last_used_at` — but **not** `uploaded_at`, **not** `title`, and **not** `source_name`.

A document's name is part of its identity. When the same content arrives under a different file name, the first name stands, because the first name is the one the user gave it. This is a product decision made on the user's behalf, and it is the one to reverse first if it turns out wrong.

### "Archived" and "last used" are two timestamps

The schema gained a column, so `PRAGMA user_version` went from 2 to 3.

- `uploaded_at` — when the document was first archived. Written once. Never moved.
- `last_used_at` — when it was last archived or last reviewed. Moves on every use.

Migration v3 adds the column with `DEFAULT ''` and backfills it from `uploaded_at`, so every existing row keeps a sensible "last used" without a second pass. A database that only ever held settings has no `documents` table, and the migration checks `sqlite_master` before touching anything — the v2→v3 step on such a database is a no-op rather than an error.

This is the split that makes the Library list honest. Reviewing a document from the Library refreshes `last_used_at` and leaves `uploaded_at` alone. Before the split, the from-library review path refreshed `uploaded_at`, which reordered the whole Library and made "recently archived" and "recently reviewed" indistinguishable.

`findDocumentBySha256()` returns the **oldest** match, so the document the library points at is the one that was first archived under that name.

### The list folds the copies under their document

The Library renders one row per document. Copies live underneath their primary in a collapsed section, and a notice above the list says how many groups repeat and how many archives that is in total.

The primary row is the oldest copy in the group — the copy the references point at. It carries the review checkbox. The copies do not: they are the same content, so picking one is picking the others, and a checkbox that could only ever mean "the same thing" would be a lie about what the user is choosing.

The rendering is a pure function in `public/js/library-groups.js` — `groupLibraryByContent()`, `duplicateCountsByContent()`, and `renderLibraryGroups()` — so the grouping rules are checked without a browser. `public/index.html` only wires up the DOM.

### The user is told before they upload

`/api/read` and `/api/review` compute the content hash of each uploaded file and look it up. When a match exists, the response carries `duplicateOf: { id, title, uploadedAt }` on that document, and the reading list says so: *这份内容已在资料库里（title，date），会作为一份新的归档保存。*

The wording matters as much as the check. It says the content is already there **and** that a new archive will be saved. Marking without that sentence would look like the upload was refused.

### One selection of identical files is one document

Within a single upload, two files with the same content hash are one document. The second is dropped from the scope — running the model twice over identical bytes wastes the user's tokens and would produce a document compared against itself. In `/api/read` the dropped file stays visible in the session as a per-file failure, so the user is not left wondering where it went. In `/api/review`, a selection that collapses to nothing is a 400.

## Scope

- `src/storage/database.ts`: schema v3, the `last_used_at` column and its migration, the changed `ON CONFLICT` clause, `findDocumentBySha256()`, and the extra column in the list/read queries.
- `src/storage/library-store.ts`: `LibraryEntry.lastUsedAt`; `saveLibraryDocument()` no longer invents its own `uploadedAt`.
- `src/server.ts`: `contentHashOf()`, `findDuplicateOf()`, `DuplicateOf`, `ReadDocument.duplicateOf`, and both upload routes minting a fresh id per file while marking the duplicates.
- `public/js/library-groups.js`: the grouping and rendering functions.
- `public/index.html`, `public/styles.css`: the grouped Library list, the expand/collapse control, and the duplicate notice on the reading list.
- `scripts/verify-library-groups.mjs` and `scripts/verify-library-identity.mjs`.

## Outcome

- The Library shows `3 组内容相同，共 30 份归档。展开可以看到每一次归档。` over three rows, each with `另有 9 份相同内容 ▾`. Expanding a group lists each copy with its own date.
- Uploading a document whose content is already archived reports the existing document and states that a new archive will be saved.
- Two identical files in one selection produce one document and one visible failure.
- A review started from the Library refreshes `last_used_at` and leaves `uploaded_at` alone; the Library's order does not move.

`scripts/verify-library-groups.mjs` passes with twelve checks and `scripts/verify-library-identity.mjs` with nine, both offline.

## Follow-up

- **This does not save disk.** Every upload is still stored as its own archive. Marking and folding make the list readable; they do not remove a byte. Deleting the copies would need a destructive operation that a user has to ask for by name.
- **Old archives are not collapsed retroactively.** The thirty archives in the local library are now folded into three rows, but thirty directories are still on disk.
- **The title is not overwritten** when the same content arrives under a new name. This was decided on the user's behalf; it is the cheapest thing to change if it is wrong.
- **Near-duplicates are not detected.** A PDF that is the same contract with one changed page has a different hash and is a different document. MinHash/LSH, as `paperless-ngx-dedupe` does it, is a different piece of work.
