---
id: setup-001
scope: first-run-model-setup
depends-on: [storage-001, web-001]
status: done
---

# setup-001: Custom model setup and first-run gate

## Objective

Replace preselected provider/model settings with separate custom endpoint forms for the main model and scanned-page vision model. Support the three protocol options in the layout contract, server-side model discovery with manual ID fallback, SQLite persistence, and first-run gating: both complete profiles skip setup; otherwise selection remains gated.

## Context

- [Local storage and model configuration](../../modules/local-storage-and-models.md)
- [Web reading surface](../../modules/web-reading.md)
- [Model setup layout](../../modules/model-setup-layout.md)
- [Pi Architecture](../../architecture.md)

## Path

- `src/storage/database.ts`
- `src/server.ts`
- `src/agent.ts`
- `public/index.html`
- `scripts/verify-storage.mjs`
- `scripts/verify-web-read.mjs`
- `docs/INDEX.md`
- `docs/modules/local-storage-and-models.md`
- `docs/modules/web-reading.md`
- `docs/modules/model-setup-layout.md`
- `docs/plan/README.md`
- `docs/architecture.md`
- `docs/plan/tasks/setup-001-custom-model-setup.md`

## Verification

- Migration from SQLite v1 retains existing built-in model profiles and defaults them to legacy catalog resolution.
- A migrated legacy catalog profile without a stored API key remains complete when Pi can resolve ambient provider credentials; missing credentials keep setup gated.
- Custom profiles persist protocol, Base URL, model ID, and plaintext API key for main and vision independently.
- Discovery requests for all three protocol types normalize model IDs, honor timeout/response limits, and return actionable errors without persisting keys.
- Custom models resolve through Pi for main and scan vision calls; vision calls still carry rendered page images.
- Incomplete profiles gate document selection; complete profiles skip setup.
- Empty saved API Key preserves the stored key when editing; explicit clear removes it.
- Run `npm run typecheck`, `npm run verify:storage`, `npm run verify:web-read`, and `git diff --check`.
