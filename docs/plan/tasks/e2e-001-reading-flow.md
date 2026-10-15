---
id: e2e-001
scope: agent-reading-acceptance
status: pending
depends-on: [pdf-001, pdf-002, skill-001, agent-001, agent-002, web-001]
---

# Objective

Verify the complete user-visible PDF flow across the real Web entry, Pi Agent loop, text extraction/OCR, overview skill, Q&A retrieval, Markdown renderer, local library, and citation navigation.

# Context

- `docs/INDEX.md`
- `docs/architecture.md`
- `docs/plan/analysis/agent-first-reading.md`
- All predecessor task files listed in `depends-on`

# Path

- Relevant integration/acceptance test files under `src/**` or `tests/**`
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- Happy path: read text-native, scanned, and mixed PDFs; store source/Markdown; return overview; ask a follow-up question; cite source pages.
- No-evidence: ask something not established by the PDFs and confirm the answer does not invent a fact.
- Negative cases: malformed PDF, missing model configuration, abort, OCR/page-render failure, and one failed file among valid files.
- Confirm browser navigation opens the exact cited document and page.
- Run the project verification suite and record any non-blocking findings in `docs/plan/backlog.md`.
