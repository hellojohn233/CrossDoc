# CrossDoc Delivery Plan

This plan first completes one user-visible PDF reading slice: text-native and scanned pages become source-aware Markdown, the agent creates an initial concise overview, and the user can ask cited follow-up questions. PDF page classification happens per page so mixed PDFs work naturally.

## Sequence

```text
pdf-001 classify pages and normalize native text
  -> ingest-001 line-level blocks and source-aware Markdown
      -> pdf-002 render scans and read with Pi vision
          -> skill-001 overview and grounded Q&A
              -> agent-001 task-directed Pi loop and scoped tools
                  -> agent-002 bounded concurrent PDF reading
                      -> web-001 overview/Q&A UI and library integration
                          -> storage-001 local SQLite index and independent main/vision model profiles
                              -> setup-001 custom model setup and first-run gate
                                  -> ui-001 header navigation and unified visual system
                                  -> e2e-001 PDF acceptance
                                  -> review-001 optional consistency-review skill
                                  -> review-002 semantic conflict adjudication
                                  -> review-003 key data alignment
                                      -> review-004 skill-driven review
```

The scan-reading engine is Pi vision, as selected by the user. Task paths may overlap; work serially unless an isolated worktree is deliberately used. Current task status is listed below.

## Tasks

| ID | Scope | Objective | Depends on | Status |
|---|---|---|---|---|
| `pdf-001` | PDF ingestion | Classify pages as text-native, scan, or blank/unknown; preserve native text blocks and PDF locations | — | done |
| `ingest-001` | Block granularity | Group native text items and vision transcripts into line-level blocks; key Markdown source notes by source position | `pdf-001` | done |
| `pdf-002` | Scan reading | Render scanned pages, read them with Pi vision, save page-level text blocks, and emit page warnings | `pdf-001` | done |
| `skill-001` | Overview and Q&A | Add a concise document-overview skill and source-grounded follow-up retrieval behavior | `pdf-001`, `pdf-002` | done |
| `agent-001` | Pi orchestration | Make Pi task-directed; expose scoped inspect, skill, parse, and search tools; keep review optional | `pdf-001`, `pdf-002`, `skill-001` | done |
| `agent-002` | Concurrent reading | Parse selected PDFs concurrently under a cap of three, retain order, and report partial failures | `agent-001` | done |
| `web-001` | Web integration | Start reading after selection, show overview and cited follow-up Q&A, and archive source/Markdown | `agent-001`, `agent-002` | done |
| `storage-001` | Local storage and models | Add SQLite library/config storage and separate main chat from scan vision model | `agent-001`, `web-001` | done |
| `setup-001` | Model setup | Configure custom Base URL, protocol, model discovery, SQLite persistence, and first-run gate | `storage-001`, `web-001` | done |
| `ui-001` | Web UI | Replace the header case strip with upload/library/configuration tabs, drop the model-setup startup gate, and unify the visual system | `web-001`, `setup-001` | done |
| `ui-002` | Web UI | Rebuild the conflict ledger as a single-column register with inline A/B redline comparison, evidence links, and a defined `/api/review` contract | `ui-001` | done |
| `e2e-001` | PDF acceptance | Verify native, scanned, and mixed PDFs through actual UI, Pi loop, loaders, SQLite-backed library, overview, and citations | `pdf-001`, `pdf-002`, `skill-001`, `agent-001`, `agent-002`, `web-001`, `storage-001` | pending |
| `review-001` | Optional review | Expose existing comparison/report tools only when requested | `agent-001`, `web-001` | done |
| `review-002` | Semantic adjudication | Split conflict detection into rule-based recall, language-model adjudication, and evidence verification | `ui-002` | done |
| `review-003` | Key data alignment | Review key data instead of sentence chunks: the model extracts key data per document, the documents are lined up by a fixed key vocabulary, and only differing values are judged | `review-002` | done |
| `review-004` | Skill-driven review | Move the review procedure out of the code and into skills, and let one agent read the skills and drive the tools | `review-003` | done |

## Acceptance Slice

Select a native PDF, a scan, or a mixed PDF. CrossDoc classifies each page, extracts text or OCRs the page, writes source-aware Markdown and archives both representations. It then returns a short overview with page citations. The user can ask a question; the agent retrieves relevant blocks and answers with page citations that open the archived source PDF at the cited page. Empty retrieval does not produce an invented answer. This path does not run comparison unless requested.

## Plan Artifacts

- [PDF reading design](../modules/pdf-reading.md)
- [Review adjudication](../modules/review-adjudication.md)
- [Agent-first reading analysis](./analysis/agent-first-reading.md)
- Tasks: [`pdf-001`](./tasks/pdf-001-page-classification.md), [`ingest-001`](./tasks/ingest-001-line-blocks.md), [`pdf-002`](./tasks/pdf-002-scan-ocr.md), [`skill-001`](./tasks/skill-001-overview-qa.md), [`agent-001`](./tasks/agent-001-dynamic-loop.md), [`agent-002`](./tasks/agent-002-parallel-reading.md), [`web-001`](./tasks/web-001-agent-entry.md), [`storage-001`](./tasks/storage-001-local-db-and-model-roles.md), [`setup-001`](./tasks/setup-001-custom-model-setup.md), [`ui-001`](./tasks/ui-001-navigation-and-visual-hierarchy.md), [`ui-002`](./tasks/ui-002-conflict-ledger.md), [`e2e-001`](./tasks/e2e-001-reading-flow.md), [`review-001`](./tasks/review-001-optional-review.md), [`review-002`](./tasks/review-002-semantic-adjudication.md), [`review-003`](./tasks/review-003-key-data-alignment.md), [`review-004`](./tasks/review-004-skill-driven-review.md)
- [Backlog](./backlog.md)
