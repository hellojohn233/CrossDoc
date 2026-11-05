---
id: ui-003
scope: review-desk-gaps
depends_on: [ui-002, review-003]
status: done
---

# ui-003: Close the review desk gaps

## Objective

Close the five gaps that made the review desk feel unfinished: a review could not be looked at again, a model configuration could not be tested, the ledger could not be narrowed down, the Library could not start a review, and two documents could not be read side by side.

## Context

`ui-002` rebuilt the conflict ledger as a single-column register and defined the `/api/review` contract the UI depends on. `review-003` made the review judge key data instead of sentence chunks. Both were correct, and both left the desk with holes a user hits in the first minute.

- **A review was gone after the run.** The artifact was written to `.crossdoc/reviews/<id>/review.json` and never read back. Every review cost a full model run, and comparing two runs meant keeping the browser page open.
- **A model configuration was a guess.** The page could save a Base URL, a protocol, a model id, and a key, and the only way to learn whether any of it was right was to start a review and read the error.
- **Four conflicts had to be read one by one.** The ledger had a status split and a text search, but no severity filter and no way to say "only the conflicts between these two documents".
- **The Library was a dead end.** Documents were archived, and starting a review meant uploading the same files again.
- **Two documents could only be compared through a finding.** The A/B sides of a conflict show two quotes. Reading a whole document against a whole document had nowhere to happen.

## Decision

Five gaps, five answers. Two of them needed a server endpoint, two needed only a front end, and one needed both.

### A review is an artifact, so the API can read it back

`src/storage/review-store.ts` gained `listReviewArtifacts()` and `readReviewArtifact()`. The list is ordered by directory modification time, newest first. The detail reader only accepts an id matching `^[A-Za-z0-9_-]{1,128}$` and reads it through a resolved path, so a traversal attempt is a 404 rather than a file read.

`GET /api/reviews` returns the list; `GET /api/reviews/:id` returns one review.

The important part is that the stored body and the live body are the same body. `reviewResponseBody()` is a single module-level function used by both `streamReview()` and the stored route, so a reopened review shows exactly what the original run showed. Two shapes that drift apart would have made "reopen" a lie.

The review records live in the Library view as a second block. The header keeps three tabs; the history is not a fourth tab, because the Library is where the documents a review is about already are.

### A model configuration can be tested without being saved

`POST /api/settings/models/test` resolves the profile the way a real request would and then sends one short prompt.

The test resolves against a throwaway `createBuiltinModels()` catalog rather than the shared one. Sharing it would have been one line shorter and would have let a test's Base URL overwrite the saved profile, so the test would prove the connection by breaking the configuration.

The test proves reachability, not capability: the endpoint, the protocol, the model id, and the key line up. It does not prove that a model accepts images, so the vision panel says so rather than implying more than was checked. An omitted key falls back to the stored key for that role, so a saved configuration can be tested without typing the key again.

### The ledger filters, and the toolbar stops moving

Severity and document joins the status tabs and the search field. The document filter matches a conflict when either side cites that document. The search covers the title, the id, the rationale, and both sides' title, page, and quote — the rationale and the quotes are where the wording the user remembers actually is.

The first implementation rebuilt the whole ledger on every keystroke, which destroyed the search field the user was typing into. The toolbar is now rendered once per mount; filtering repaints the entry list and the match count only.

### The Library starts a review

`POST /api/review/from-library` resolves the picked document ids against the library and reads the archived source file, so a review does not need the file uploaded again. It writes to the same stream `POST /api/review` produces, and therefore to the same artifact format.

The picker requires at least two documents. The button says so before it is pressed rather than after.

### Two documents can be read side by side

The review console carries a folded `文档对照` panel with one document selector per side and the archived Markdown rendered as preformatted text. It reads `documents[].markdown` from the review response, so it needed no endpoint of its own.

## Scope

- Add `listReviewArtifacts()` and `readReviewArtifact()` to `src/storage/review-store.ts`.
- Extract `streamReview()` and `reviewResponseBody()` in `src/server.ts`; add `POST /api/review/from-library`, `GET /api/reviews`, `GET /api/reviews/:id`, and `POST /api/settings/models/test`.
- Add a `models` option to `WebAppOptions` so an integration test can drive a review with a scripted catalog.
- Add the Library review-records block, the selection bar, the per-document checkbox, the document comparison panel, and the connection test buttons to `public/index.html` and `public/styles.css`.
- Add severity and document filters to `public/js/conflict-ledger.js`, widen the search, and split the toolbar from the entry list.
- Add `scripts/verify-review-library.mjs`.

## Outcome

Every gap is closed and walked through in the browser.

- The Library lists nine stored reviews; opening one fills the console with its four conflicts, its filters, and its comparison panel.
- The connection test answers `连接正常 · 0.9s · 回复「ok」` for the main role and `连接正常 · 1.0s · 回复「ok」` for the vision role.
- The document filter on contract-b narrows four conflicts to three and reports `3/4 匹配`; the search on `effective date` narrows it to one, and `120000` narrows it to one.
- A review started from the Library over two archived documents ran to completion: two documents, fourteen key data items, one verified conflict.

`scripts/verify-review-library.mjs` passes with eight checks and runs offline, against a scripted model catalog and a local fake OpenAI-compatible endpoint.

## Follow-up

- The Library lists one row per archived document, so repeated reviews of the same three contracts have accumulated thirty-three rows. The rows are distinct documents with distinct ids, and de-duplicating them is a decision about what a document *is*, not a rendering fix.
- The connection test proves reachability. A separate check would be needed to prove that a vision model accepts images.
