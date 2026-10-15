---
id: skill-001
scope: document-reading-skills
status: done
depends-on: [pdf-001, pdf-002]
---

# Objective

Add the concise `document-overview` skill content and a bounded lexical retrieval utility for parsed PDFs. This task owns the reusable skill and pure retrieval contract only; Pi tool registration, skill loading, page-text saving, and request state are owned by `agent-001`. Native and vision-read content use the same normalized blocks.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/core/claims.ts`
- `src/markdown/document.ts`

# Path

- `.agents/skills/document-overview/SKILL.md`
- `.agents/skills/pdf-reading/SKILL.md` if a format skill remains useful
- `src/skills/**`
- `src/tools/**`
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- The checked-in overview skill defines a concise cited summary and evidence-only follow-up response.
- Retrieval accepts only validated parsed-document inputs, bounds query and result sizes, and returns a small set of relevant blocks with stable IDs and page locations.
- Chinese and English competing candidates are ranked with deterministic ordering; no evidence returns an explicit `no-match` result.
- This task does not register the skill or retrieval utility with Pi; that real integration is verified by `agent-001`.
- Run typecheck and focused skill/retrieval tests.
