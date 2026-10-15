# Local Storage and Model Configuration

## Goal

Keep the single-user installation's library index, user settings, and model profiles in a local SQLite database. Keep source and derived document files as ordinary files below `data/library/`. Configure the Pi orchestration model separately from the vision model used to read scanned PDF pages.

## Local data layout

```text
data/
├── crossdoc.sqlite
└── library/<document-id>/
    ├── source.pdf
    ├── document.json
    └── document.md
```

The database stores paths relative to `data/`, never machine-specific absolute library paths. `document.json` is the canonical structured `ParsedDocument`, including page and block source locations. `document.md` is the readable/rendered artifact. The source file remains unchanged. Document bytes do not go into SQLite.

## SQLite schema

- `documents`: stable ID, display/source name, format, page count, file size/hash, imported timestamp, and relative paths to source, structured JSON, and Markdown.
- `model_configs`: one row for each `role` (`main` or `vision`), with provider ID, model ID, optional base URL, plaintext API key, and provider options JSON. Upsert by role so each role has one active profile.
- `app_settings`: small user preferences stored as key/value JSON, with schema evolution tracked by `PRAGMA user_version` migrations.

The app is intentionally single-user/local and the production HTTP server binds only to `127.0.0.1`; it is not exposed on LAN interfaces. API keys are stored as plaintext in SQLite, as requested. The database stays under ignored `data/` and is never added to Git. The settings API relies on this loopback-only deployment boundary and does not provide user authentication.

At database initialization, import existing `data/library/*/metadata.json` records idempotently so the current filesystem library remains visible after the index moves to SQLite. New imports write the source, `document.json`, and `document.md`, then upsert the document row. Library list and read routes use the SQLite index and resolve each relative path under `data/`.

## Model roles

- **Main model:** Pi Agent Core uses this chat model for tool selection, format/skill orchestration, overview, and follow-up answers. Its provider, model ID, API key, and optional base URL come from the `main` row.
- **Vision model:** only the scan-page reading tool uses this image-capable model. CrossDoc renders one scan page, calls Pi AI's `Models.completeSimple()` with a short transcription prompt plus that PNG, saves the returned transcript as a page-level block, and returns text to the main agent. The main model may be text-only.

Both providers and model IDs must resolve in Pi AI's built-in model catalog. The vision role additionally requires image input. Per-request credentials and base URL are passed through Pi AI request options; configuration is validated before accepting a read. Missing main or vision config returns an actionable setup error. The UI's model settings form is the normal configuration entry point.

## API and UI contract

- `GET /api/settings` returns user preferences and both model profiles, with an `apiKeyConfigured` flag; it does not echo the saved key.
- `PUT /api/settings/models/:role` validates provider/model and stores the submitted plaintext key. An empty key on update preserves the current key; an explicit clear action removes it.
- The start page has a compact Settings entry. It opens a local form for main and vision provider, model ID, optional base URL, and API key; no model keys are rendered into page content after save.
- Reading and library endpoints use the stored profile and SQLite metadata. Existing PDF citation/source URLs remain stable.

## Boundaries

SQLite is an index/config store, not an agent transcript store and not a blob store. Active Pi sessions remain in memory. Source-aware JSON/Markdown artifacts remain individually readable and portable. This module does not add multi-user accounts, cloud sync, or full provider model discovery.
