---
id: skill-001
scope: document-reading-skills
status: in-progress
depends-on: [pdf-001, pdf-002]
---

# Objective

Add a concise `document-overview` skill and the instructions/tools needed to answer follow-up questions from parsed PDFs. Overview and answers must use the same normalized blocks regardless of whether a page was natively extracted or OCRed.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/agent.ts`
- `src/core/claims.ts`
- `src/markdown/document.ts`

# Path

- `.agents/skills/document-overview/SKILL.md`
- `.agents/skills/pdf-reading/SKILL.md` if a format skill remains useful
- `src/skills/**`
- `src/tools/**`
- `src/agent.ts`
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- Initial reading loads the overview skill and returns a concise, cited summary.
- A follow-up question retrieves a small set of relevant blocks with stable IDs and page locations.
- The agent answers with source-page citations and declines unsupported claims when retrieval has no evidence.
- Overview/Q&A does not invoke consistency comparison unless requested.
- Run typecheck and focused skill/retrieval tests.
