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
- `model_configs`: one row for each `role` (`main` or `vision`), with the legacy provider ID, protocol/API ID, model ID, base URL, plaintext API key, and provider options JSON. Upsert by role so each role has one active profile. Migration v2 adds the protocol column and preserves v1 catalog-based profiles.
- `app_settings`: small user preferences stored as key/value JSON, with schema evolution tracked by `PRAGMA user_version` migrations.

The app is intentionally single-user/local and the production HTTP server binds only to `127.0.0.1`; it is not exposed on LAN interfaces. API keys are stored as plaintext in SQLite, as requested. The database stays under ignored `data/` and is never added to Git. The settings API relies on this loopback-only deployment boundary and does not provide user authentication.

At database initialization, import existing `data/library/*/metadata.json` records idempotently so the current filesystem library remains visible after the index moves to SQLite. New imports write the source, `document.json`, and `document.md`, then upsert the document row. Library list and read routes use the SQLite index and resolve each relative path under `data/`.

## Model roles

- **Main model:** Pi Agent Core uses this chat model for tool selection, format/skill orchestration, overview, and follow-up answers. Its provider, model ID, API key, and optional base URL come from the `main` row.
- **Vision model:** only the scan-page reading tool uses this image-capable model. CrossDoc renders one scan page, calls Pi AI's `Models.completeSimple()` with a short transcription prompt plus that PNG, saves the returned transcript as a page-level block, and returns text to the main agent. The main model may be text-only.

New profiles use a custom endpoint instead of selecting a provider. The saved protocol maps to one of three Pi APIs: `openai-completions` (OpenAI-compatible Chat Completions), `anthropic-messages` (Anthropic Messages), or `google-generative-ai` (Google Gemini API). Each role stores its own protocol, base URL, selected model ID, and plaintext API key. Pi AI receives a custom provider/model built from those fields; the vision role is marked as image-capable and must be configured with an image-capable model. Existing v1 profiles without a protocol continue to resolve through their saved Pi catalog provider and model ID.

The settings UI can request the endpoint's model list after Base URL, protocol, and API Key are entered. It parses protocol-specific list response envelopes and offers returned model IDs for selection. If the endpoint does not expose model discovery or returns no usable IDs, the user can enter a model ID manually. Discovery runs server-side with a 10-second timeout and a 1 MiB response cap, and does not persist the entered API Key until the profile is saved. Missing main or vision config returns an actionable setup error.

## API and UI contract

- `GET /api/settings` returns user preferences and both model profiles, with an `apiKeyConfigured` flag; it does not echo the saved key.
- `POST /api/settings/models/discover` accepts a role, protocol, Base URL, and API Key; it returns normalized model IDs/names without saving the profile.
- `PUT /api/settings/models/:role` validates and stores protocol, Base URL, model ID, and plaintext key. An empty key on update preserves the current key; an explicit clear action removes it.
- On app entry, the UI loads settings before showing document selection. If both model profiles are complete, it skips setup and opens selection; otherwise it presents the two-profile setup gate. No model keys are rendered into page content after save.
- The setup form has no provider selector. Each role shows Base URL, protocol type, model selection with a `加载模型` action, and API Key. A model ID may also be entered manually.
- Reading and library endpoints use the stored profile and SQLite metadata. Existing PDF citation/source URLs remain stable.

## Boundaries

SQLite is an index/config store, not an agent transcript store and not a blob store. Active Pi sessions remain in memory. Source-aware JSON/Markdown artifacts remain individually readable and portable. This module does not add multi-user accounts, cloud sync, or full provider model discovery.
