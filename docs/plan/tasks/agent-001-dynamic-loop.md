---
id: agent-001
scope: agent-runtime
status: pending
depends-on: [pdf-001, pdf-002, skill-001]
---

# Objective

Make the existing `pi-agent-core` agent a task-directed tool loop for the PDF reader. Remove the prompt that requires every task to call parse, extract, compare, verify, and report in order. Supply request-scoped inspect, overview-skill, PDF-reading, and search tools; retain review tools as optional capabilities. Resolve a model explicitly and return an actionable setup error when none is configured.

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
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- With an actual Pi Agent loop and scripted model stream, a read request can inspect, parse native/OCR pages, load the overview skill, and search without calling comparison tools.
- A task asking for consistency review can call review tools; no global system-prompt order forces that path for other tasks.
- Tools reject document IDs outside the current request scope.
- Model/provider absence yields a clear setup error before a web job is accepted.
- Run typecheck and focused agent/tool integration tests.
