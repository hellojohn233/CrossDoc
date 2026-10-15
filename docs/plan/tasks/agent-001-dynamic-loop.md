---
id: agent-001
scope: agent-runtime
status: in-progress
depends-on: [pdf-001, pdf-002, skill-001]
---

# Objective

Make the existing `pi-agent-core` agent a task-directed tool loop for the PDF reader. Remove the prompt that requires every task to call parse, extract, compare, verify, and report in order. Supply request-scoped inspect, overview-skill, PDF-reading, scan-page rendering, page-text saving, and search tools; connect the checked-in overview skill and lexical retrieval utility; retain review tools as optional capabilities. Register Pi AI built-in providers and resolve the explicit authenticated, image-capable model named by `CROSSDOC_VISION_MODEL`; fail before accepting work with an actionable error if it is absent or unsuitable.

# Context

- `docs/INDEX.md`
- `docs/architecture.md`
- `docs/plan/analysis/agent-first-reading.md`
- `docs/modules/pdf-reading.md`
- `src/agent.ts`
- `src/review.ts`
- `src/tools/**`
- `src/core/claims.ts`

# Path

- `src/agent.ts`
- `src/tools/**`
- `src/review.ts` only if required to remove orchestration from the agent entry point
- `src/core/**` only if required by scoped handles or citations
- `.env.example` and README setup notes for model configuration
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- With an actual Pi Agent loop and scripted model stream, a read request can inspect, parse native/OCR pages, load the overview skill, and search without calling comparison tools.
- A task asking for consistency review can call review tools; no global system-prompt order forces that path for other tasks.
- Vision reading returns one scan page image per call, and save_page_text creates a page-level block, updates Markdown/library state, and removes that page's pending warning.
- Tools reject document IDs outside the current request scope.
- Missing model configuration, missing provider credentials, unknown model ID, or missing image input yields a clear setup error before a web job is accepted.
- Run typecheck and focused agent/tool integration tests.
