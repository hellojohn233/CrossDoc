# Backlog

- **P2 · PDF rendering coverage:** `scripts/verify-pdf-page-render.mjs` uses empty pages, so it validates PNG structure and dimensions but not visible rendered pixels. Add a visible-content fixture and pixel assertion in a follow-up renderer verification task. See `docs/plan/reviews/pdf-002-001.md`.
- **P2 · Retrieval corpus work bound:** `searchDocument()` caps query and document count, but currently scans and ranks every block before applying the excerpt cap. Add an aggregate block/text-size limit or bounded top-k scan for very large libraries. See `docs/plan/reviews/skill-001-001.md`.
