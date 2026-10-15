# Backlog

- **P2 · PDF rendering coverage:** `scripts/verify-pdf-page-render.mjs` uses empty pages, so it validates PNG structure and dimensions but not visible rendered pixels. Add a visible-content fixture and pixel assertion in a follow-up renderer verification task. See `docs/plan/reviews/pdf-002-001.md`.
- **P2 · Retrieval corpus work bound:** `searchDocument()` caps query and document count, but currently scans and ranks every block before applying the excerpt cap. Add an aggregate block/text-size limit or bounded top-k scan for very large libraries. See `docs/plan/reviews/skill-001-001.md`.
- **P2 · Model-selected parse order:** Pi preserves the order of parse tool calls emitted by the model, while the model is instructed to emit calls in selected-file order. If a future UI needs a hard guarantee independent of model output, add a batch parse boundary that sorts by the server's original request scope. See `docs/plan/reviews/agent-002-001.md`.
- **P2 · Web session and scan-budget edge coverage:** Add tests for six busy sessions and seventh-session rejection/idle eviction, plus a session-wide text budget crossed only by scan-page appends. See `docs/plan/reviews/web-001-001.md`.
- **P2 · Web SSE backpressure and recovery coverage:** Bound slow or numerous SSE listeners and test event-ring compaction snapshot replay. See `docs/plan/reviews/web-001-001.md`.
- **P2 · Web terminal read states:** Replace the overview placeholder after all-failed/cancelled/no-text runs and expose a reconnect action after terminal EventSource failure. See `docs/plan/reviews/web-001-001.md`.
