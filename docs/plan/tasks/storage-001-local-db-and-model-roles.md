---
id: storage-001
scope: local-storage-and-model-configuration
depends-on: [agent-001, web-001]
status: done
---

# storage-001: SQLite library index and separate model roles

## Objective

Add a local SQLite database for library metadata, user settings, and independent main/vision model profiles. Preserve existing library files and expose a small settings form/API. Route ordinary Pi orchestration through the main model and scanned-page transcription through a separate Pi AI vision request.

## Contract

Follow [the local storage and model configuration design](../../modules/local-storage-and-models.md). The database is `data/crossdoc.sqlite`; source PDFs and derived `document.json`/`document.md` remain under `data/library/<id>/`. Persist model provider, model ID, optional endpoint/options, and plaintext API key for the single local user. Keep paths relative to the data root and migrate existing `metadata.json` records idempotently.

The main model handles the agent loop, overview, and Q&A. A text-only main model must work with scanned PDFs: a scoped sequential tool renders one scan page and calls the configured image-capable vision model through Pi AI, saves the resulting transcript/provenance, and returns text to the main agent. Validate both roles before accepting a reading request.

## In scope

- SQLite schema creation and versioned migrations.
- Library index/store migration with structured JSON persistence and legacy metadata import.
- Read/update settings routes and compact UI to configure each model role.
- Pi AI main model streaming with the saved main credentials.
- Pi AI one-shot vision transcription with the saved vision credentials.
- Deterministic tests using injected model streams/calls; no live provider API keys required.
- Update README, architecture, module docs, and plan statuses.

## Out of scope

- Multi-user auth, remote database, cloud sync, encrypted credential storage, OAuth login UX, non-PDF loaders, or vector search.

## Acceptance criteria

- Startup creates/opens SQLite and applies migrations without losing existing file-based library entries.
- A new successful PDF read writes source, canonical structured JSON, Markdown, and a database row; citations still open the archived source page.
- Main and vision profiles are independently persisted and validated; empty values return actionable setup errors.
- The main model receives no scan image when it is text-only; the vision model receives exactly one rendered page per call and its response becomes a saved page-level source block.
- Existing PDF reading, parallel parse limits, overview, follow-up citation, and optional review behavior remain available.
- `npm run typecheck`, relevant verification scripts, database migration tests, and `git diff --check` pass.
