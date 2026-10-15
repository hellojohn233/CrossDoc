---
id: web-001
scope: web-agent-entry
status: in-progress
depends-on: [agent-001, agent-002]
---

# Objective

Connect the Web UI to PDF reading. After the user selects PDFs and starts reading, the server scopes document handles, runs the Pi Agent, streams useful progress, archives source/Markdown artifacts, and presents the concise initial overview with source links. Keep a follow-up question input active against the parsed documents. Replace the fixed review-only Web request as the primary path.

Follow [the Web reading surface contract](../../modules/web-reading.md) for page states, API/SSE events, in-memory Pi session scope, cancellation, citation-token rendering, and responsive layout. Keep the initial selection page concise and preserve the existing visual style and Library entry.

# Context

- `docs/INDEX.md`
- `docs/architecture.md`
- `docs/plan/analysis/agent-first-reading.md`
- `src/server.ts`
- `src/agent.ts`
- `src/storage/library-store.ts`
- `public/index.html`

# Path

- `src/server.ts`
- `src/agent.ts`
- `src/storage/library-store.ts`
- `public/index.html`
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- Selecting native, scanned, or mixed PDFs and starting reading reaches the real Pi Agent, parser/OCR, overview skill, and local library.
- The initial overview is concise, cites source pages, and reports OCR uncertainty where relevant.
- Follow-up questions retrieve relevant normalized blocks and cite the archived PDF at the cited page.
- Progress events distinguish detection, extraction/OCR, overview, and response without forcing review stages.
- Empty task, unsupported file, model misconfiguration, abort, and partial parser failure have visible actionable UI states.
- The start page continues to show only the Library entry and file/folder selection; it does not list library documents.
- `npm run typecheck`
- `npm run verify:agent`
- `npm run verify:agent-parallel`
- `npm run verify:document-search`
- `npm run verify:web-read`
- Browser check of the local selection page and browser console; scripted API integration uses an injected Pi stream so it does not require credentials.
