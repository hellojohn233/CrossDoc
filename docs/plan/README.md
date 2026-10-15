# CrossDoc Delivery Plan

This plan first completes one user-visible PDF reading slice: text-native and scanned pages become source-aware Markdown, the agent creates an initial concise overview, and the user can ask cited follow-up questions. PDF page classification happens per page so mixed PDFs work naturally.

## Sequence

```text
pdf-001 classify pages and normalize native text
  -> pdf-002 render scans and read with Pi vision
      -> skill-001 overview and grounded Q&A
          -> agent-001 task-directed Pi loop and scoped tools
              -> agent-002 bounded concurrent PDF reading
                  -> web-001 overview/Q&A UI and library integration
                      -> e2e-001 PDF acceptance
                          -> review-001 optional consistency-review skill
```

All tasks are pending. The scan-reading engine is Pi vision, as selected by the user. Task paths may overlap; work serially unless an isolated worktree is deliberately used.

## Tasks

| ID | Scope | Objective | Depends on | Status |
|---|---|---|---|---|
| `pdf-001` | PDF ingestion | Classify pages as text-native, scan, or blank/unknown; preserve native text blocks and PDF locations | — | done |
| `pdf-002` | Scan reading | Render scanned pages, read them with Pi vision, save page-level text blocks, and emit page warnings | `pdf-001` | in-progress |
| `skill-001` | Overview and Q&A | Add a concise document-overview skill and source-grounded follow-up retrieval behavior | `pdf-001`, `pdf-002` | pending |
| `agent-001` | Pi orchestration | Make Pi task-directed; expose scoped inspect, skill, parse, and search tools; keep review optional | `pdf-001`, `pdf-002`, `skill-001` | pending |
| `agent-002` | Concurrent reading | Parse selected PDFs concurrently under a cap, retain order, and report partial failures | `agent-001` | pending |
| `web-001` | Web integration | Start reading after selection, show overview and cited follow-up Q&A, and archive source/Markdown | `agent-001`, `agent-002` | pending |
| `e2e-001` | PDF acceptance | Verify native, scanned, and mixed PDFs through actual UI, Pi loop, loaders, library, overview, and citations | `pdf-001`, `pdf-002`, `skill-001`, `agent-001`, `agent-002`, `web-001` | pending |
| `review-001` | Optional review | Expose existing comparison/report tools only when requested | `agent-001`, `web-001` | pending |

## Acceptance Slice

Select a native PDF, a scan, or a mixed PDF. CrossDoc classifies each page, extracts text or OCRs the page, writes source-aware Markdown and archives both representations. It then returns a short overview with page citations. The user can ask a question; the agent retrieves relevant blocks and answers with page citations that open the archived source PDF at the cited page. Empty retrieval does not produce an invented answer. This path does not run comparison unless requested.

## Plan Artifacts

- [PDF reading design](../modules/pdf-reading.md)
- [Agent-first reading analysis](./analysis/agent-first-reading.md)
- Tasks: [`pdf-001`](./tasks/pdf-001-page-classification.md), [`pdf-002`](./tasks/pdf-002-scan-ocr.md), [`skill-001`](./tasks/skill-001-overview-qa.md), [`agent-001`](./tasks/agent-001-dynamic-loop.md), [`agent-002`](./tasks/agent-002-parallel-reading.md), [`web-001`](./tasks/web-001-agent-entry.md), [`e2e-001`](./tasks/e2e-001-reading-flow.md), [`review-001`](./tasks/review-001-optional-review.md)
- [Backlog](./backlog.md)
