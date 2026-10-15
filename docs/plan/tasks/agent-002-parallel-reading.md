---
id: agent-002
scope: document-reading
status: done
depends-on: [agent-001]
---

# Objective

Enable independent document parsing to run concurrently through Pi's parallel tool-call support and enforce a fixed CrossDoc concurrency limit of three active parses. Preserve input order in results, report per-file failures independently, and keep each parsed document's source locations intact. The cap applies to parse and persistence work for a document; scan-page vision calls remain individually bounded to one page per tool call.

# Context

- `docs/INDEX.md`
- `docs/architecture.md`
- `docs/plan/analysis/agent-first-reading.md`
- `src/agent.ts`
- `src/loaders/index.ts`
- `src/storage/library-store.ts`
- Pi Core local API for `toolExecution` and `AgentTool.executionMode`

# Path

- `src/agent.ts`
- `src/tools/**`
- `src/review.ts` only if the current serial helper needs a clearly named compatibility path
- `src/storage/library-store.ts`
- `docs/architecture.md`
- `docs/INDEX.md`

# Verification

- At least two independent real parser calls overlap, while active parses never exceed the configured cap.
- Results are returned in request order even if completion order differs.
- One malformed document produces a per-document error while valid documents are retained and archived.
- Tool-result citations retain document IDs, page/block references, and source locations.
- Run typecheck and focused concurrency/integration tests.
