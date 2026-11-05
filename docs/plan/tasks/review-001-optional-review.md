---
id: review-001
scope: consistency-review
status: done
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

# Outcome

Done. The consistency-review skill exists and the agent loads it only when the task asks for a comparison; a summary or Q&A task does not reach the review tools. Each finding keeps both source sentences and the report renders them with source links.

The file paths listed under Path and Context describe the state at the time the task was written. `src/review.ts` and the `compare.ts` / `extract.ts` tools were removed by `review-004`, which replaced the fixed pipeline with the skill-driven run described in [`review-004`](./review-004-skill-driven-review.md).
