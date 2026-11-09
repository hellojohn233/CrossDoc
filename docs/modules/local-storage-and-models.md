# Local Storage and Model Configuration

## Goal

Keep the single-user installation's library index, user settings, and model profiles in a local SQLite database. Keep source and derived document files as ordinary files below `data/library/`. Configure the Pi orchestration model separately from the vision model used to read scanned PDF pages.

## Local data layout

```text
data/
├── crossdoc.sqlite
├── library/<document-id>/
│   ├── source.pdf
│   ├── document.json
│   └── document.md
└── skills/<skill-name>/SKILL.md
```

The database stores paths relative to `data/`, never machine-specific absolute library paths. `document.json` is the canonical structured `ParsedDocument`, including page and block source locations. `document.md` is the readable/rendered artifact. The source file remains unchanged. Document bytes do not go into SQLite.

`data/skills/` holds the user's own skills. It is the user's asset, not the product's: it is ignored by Git, it is never shipped with a build, and it is written by the application rather than by hand. The built-in skills stay in `.agents/skills/` and are versioned in the repository. See [the skills contract](./skills.md).

## SQLite schema

- `documents`: stable ID, display/source name, format, page count, file size/hash, the first-archived timestamp, the last-used timestamp, and relative paths to source, structured JSON, and Markdown. The content hash is indexed, not unique: the library keeps every upload.
- `model_configs`: one row for each `role` (`main` or `vision`), with the legacy provider ID, protocol/API ID, model ID, base URL, plaintext API key, and provider options JSON. Upsert by role so each role has one active profile. Migration v2 adds the protocol column and preserves v1 catalog-based profiles.
- `app_settings`: small user preferences stored as key/value JSON, with schema evolution tracked by `PRAGMA user_version` migrations.

The app is intentionally single-user/local and the production HTTP server binds only to `127.0.0.1`; it is not exposed on LAN interfaces. API keys are stored as plaintext in SQLite, as requested. The database stays under ignored `data/` and is never added to Git. The settings API relies on this loopback-only deployment boundary and does not provide user authentication.

At database initialization, import existing `data/library/*/metadata.json` records idempotently so the current filesystem library remains visible after the index moves to SQLite. New imports write the source, `document.json`, and `document.md`, then upsert the document row. Library list and read routes use the SQLite index and resolve each relative path under `data/`.

## Document identity and timestamps

A document's identity is its content. Every upload is still archived, so two uploads of the same bytes are two archived copies of one document. Nothing is merged and nothing is deleted; the content hash is an index used to mark and to group, and it is not a unique constraint.

This follows the mature precedent. Paperless-ngx keeps `checksum` as an indexed, non-unique field, stopped rejecting duplicate documents in v3, and offers a Duplicates tab on the document page, a Duplicates filter on the list, and a `has_duplicates=true` API query. Papermerge, Mayan, and SeedDMS each keep every upload as a new version.

- **Every upload mints a new document id.** Reuse of an id across uploads is not done; the archive count and the document count are allowed to differ.
- **`uploaded_at` is written once.** It is when the document was first archived, and it never moves.
- **`last_used_at` moves.** It is when the document was last archived or last reviewed.
- **The upsert on the document id updates** format, page count, file size, content hash, the artifact paths, and `last_used_at`. It does **not** update `uploaded_at`, `title`, or `source_name`: the name the user gave a document is part of that document's identity, so the first name stands.
- **`findDocumentBySha256()` returns the oldest match**, so the document the Library points at is the one first archived under that name.
- **Migration v3 adds `last_used_at`** with `DEFAULT ''` and backfills it from `uploaded_at`. A database that only ever held settings has no `documents` table; the migration checks `sqlite_master` and skips the DDL in that case.

A document reviewed from the Library refreshes `last_used_at` and leaves `uploaded_at` alone. Before these were split, a from-Library review refreshed `uploaded_at` and reordered the whole Library, making "recently archived" and "recently reviewed" indistinguishable.

An upload whose content is already archived is marked, not refused. The upload routes compute the content hash, look it up, and report the existing document with its title and first-archived date; the reading list tells the user that the content is already in the Library and that a new archive will be saved.

Within one selection, identical files are one document. The second is dropped from the agent's scope — running the model twice over identical bytes wastes the user's tokens and would compare a document against itself. In `/api/read` the dropped file stays visible in the session as a per-file failure. In `/api/review`, a selection that collapses to nothing is a 400.

## Model roles

- **Main model:** Pi Agent Core uses this chat model for tool selection, format/skill orchestration, overview, and follow-up answers. Its provider, model ID, API key, and optional base URL come from the `main` row.
- **Vision model:** only the scan-page reading tool uses this image-capable model. CrossDoc renders one scan page, calls Pi AI's `Models.completeSimple()` with a short transcription prompt plus that PNG, saves the returned transcript as a page-level block, and returns text to the main agent. The main model may be text-only.

New profiles use a custom endpoint instead of selecting a provider. The saved protocol maps to one of three Pi APIs: `openai-completions` (OpenAI-compatible Chat Completions), `anthropic-messages` (Anthropic Messages), or `google-generative-ai` (Google Gemini API). Each role stores its own protocol, base URL, selected model ID, and plaintext API key. Pi AI receives a custom provider/model built from those fields; the vision role is marked as image-capable and must be configured with an image-capable model. Existing v1 profiles without a protocol continue to resolve through their saved Pi catalog provider and model ID.

The settings UI can request the endpoint's model list after Base URL, protocol, and API Key are entered. It parses protocol-specific list response envelopes and offers returned model IDs for selection. If the endpoint does not expose model discovery or returns no usable IDs, the user can enter a model ID manually. Discovery runs server-side with a 10-second timeout and a 1 MiB response cap, and does not persist the entered API Key until the profile is saved. Missing main or vision config returns an actionable setup error.

## API and UI contract

- `GET /api/settings` returns user preferences and both model profiles, with `apiKeyConfigured` for a saved key and non-sensitive `authAvailable` for saved or Pi ambient provider auth; it never echoes a credential.
- `POST /api/settings/models/discover` accepts a role, protocol, Base URL, and API Key; it returns normalized model IDs/names without saving the profile.
- `PUT /api/settings/models/:role` validates and stores protocol, Base URL, model ID, and plaintext key. An empty key on update preserves the current key; an explicit clear action removes it.
- On app entry, the UI loads settings before showing document selection. A legacy catalog profile is complete when its provider and model ID exist and either a key is saved or Pi reports ambient auth; a custom profile needs its protocol, Base URL, model ID, and saved key. Setup is a peer view reached from the header, not a gate: an incomplete profile never blocks the selection view. No model keys are rendered into page content after save.
- The setup form has no provider selector. Each role shows Base URL, protocol type, model selection with a `加载模型` action, and API Key. A model ID may also be entered manually.
- Reading and library endpoints use the stored profile and SQLite metadata. Existing PDF citation/source URLs remain stable.
- `GET /api/library` returns every archived document, including repeated content, each with its `sha256`, `uploadedAt`, and `lastUsedAt`. The grouping into one row per document is a client-side rendering rule, not a server-side filter, so no archive is hidden from the API.
- `DELETE /api/library/:id` removes one archive: its directory and its index row together. The id has to be a UUID, and an id that does not match is a 404.
- `DELETE /api/library` removes every archive and empties the index. It reports how many archives went.
- The settings view's `归档存储` block lists every archive, including the copies the document list folds away, and offers both removals.

## Boundaries

SQLite is an index/config store, not an agent transcript store and not a blob store. Active Pi sessions remain in memory. Source-aware JSON/Markdown artifacts remain individually readable and portable. This module does not add multi-user accounts, cloud sync, or full provider model discovery.
