# Backlog

- **P2 · PDF rendering coverage:** `scripts/verify-pdf-page-render.mjs` uses empty pages, so it validates PNG structure and dimensions but not visible rendered pixels. Add a visible-content fixture and pixel assertion in a follow-up renderer verification task. See `docs/plan/reviews/pdf-002-001.md`.
