---
id: review-001
scope: consistency-review
status: pending
depends-on: [agent-001, web-001]
---

# Objective

Expose the existing claim extraction, comparison, verification, and report functionality through an optional consistency-review skill. The agent selects this capability only when requested or when the task clearly requires document comparison.

# Context

- `docs/INDEX.md`
- `docs/architecture.md`
- `docs/plan/analysis/agent-first-reading.md`
- `src/tools/extract.ts`
- `src/tools/compare.ts`
- `src/tools/verify.ts`
- `src/tools/report.ts`
- `src/review.ts`

# Path

- `.agents/skills/consistency-review/SKILL.md`
- `src/agent.ts`
- `src/tools/**`
- `src/review.ts`
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- A summary or Q&A task does not trigger claim comparison solely because multiple files were selected.
- An explicit consistency task can load the review skill and use the real existing tools.
- Each finding retains evidence references and renders a report with source links.
- Run typecheck and focused review-skill/tool tests.
