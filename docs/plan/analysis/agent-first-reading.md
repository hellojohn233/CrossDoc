# PDF-First Reading: Analysis

## Goal

Complete the first product path around PDFs: classify text-native and scanned pages, normalize both to Markdown with source locations, produce an automatic short overview skill, and allow source-grounded follow-up questions. PDFs may be mixed, so decisions happen per page.

The later agent-directed architecture keeps Pi Agent Core as the engine and adds only CrossDoc-specific tools, skills, loaders, and UI. It does not adopt the complete Pi CLI, MCP, or a sub-agent framework.

## Current State and Gap

- `src/loaders/pdf.ts` extracts selectable text items and PDF-space bounding boxes.
- Empty-text pages currently warn that OCR is not enabled; there is no scan rendering/vision path.
- `src/markdown/document.ts` emits per-page Markdown and source footnotes.
- `src/core/claims.ts` defines PDF locations, but does not yet record extraction method per page/block.
- `src/agent.ts` defines a Pi agent, but the system prompt mandates a fixed parse/claims/compare/verify/report order and the code creates an empty provider collection.
- `src/server.ts` uses `reviewDocuments()` directly; there is no reading overview or follow-up question path.
- Local library storage saves source PDF plus parsed Markdown under `data/library/`.
- Local inspection found `unpdf`, `pdfjs-dist`, and `@napi-rs/canvas`; no local OCR engine is installed. The user selected Pi vision for scan pages with page-level provenance; Pi AI must resolve an authenticated image-capable model from `CROSSDOC_VISION_MODEL` because CLI settings are not available in this embedded app.

## Module Decomposition

| Module | Responsibility | Delivery |
|---|---|---|
| PDF page classifier | Determine text-native, scan candidate, or blank/unknown per page; retain decision metadata | `pdf-001` |
| PDF native reader | Extract native text items and existing PDF-space positions | `pdf-001` |
| Scan-page vision path | Render scan pages, send images to Pi vision, save normalized page-level text, preserve partial warnings | `pdf-002` |
| Document overview skill | Produce a concise initial overview with page citations and uncertainty notes | `skill-001` |
| Q&A retrieval | Search normalized blocks lexically and return a small source-aware evidence set | `skill-001` |
| Pi task loop | Select inspect/skill/parse/search tools based on the task; keep review optional | `agent-001` |
| Concurrent reading | Bound independent PDF parse calls and preserve stable ordering/partial successes | `agent-002` |
| Web reading surface | Start read, show overview/progress, accept follow-up questions, render page links | `web-001` |
| Optional consistency review | Expose claim comparison/report only on request | `review-001` |

## Integration Paths

1. Selected uploaded PDFs become request-scoped opaque handles; tools may not accept arbitrary local paths from model text.
2. PDF parse extracts native text and classifies each page. Scan candidates are rendered for Pi vision; blank/unknown pages remain explicit.
3. Native and vision-read blocks share the source-location contract and Markdown renderer; scan blocks use page-level provenance.
4. Successful parse stores original PDF, Markdown, and metadata in the local library.
5. After reading completes, the agent loads the overview skill and writes a short cited overview.
6. Follow-up Q&A searches selected parsed blocks and returns excerpts with block IDs/pages; the agent answers only from those excerpts and links citations to the archived PDF page.
7. Independent selected PDFs parse under a concurrency cap; one failure does not erase other successes.
8. Comparison/review tools are not called for a normal overview or question.

## Constraints and Decisions

- Page classification is per-page so mixed PDFs work.
- PDF citations initially guarantee page navigation. Bboxes are preserved for future highlights, but arbitrary rectangle highlighting depends on viewer support.
- Pi vision must produce searchable normalized content and page-level provenance. Do not invent scan text geometry.
- Pi vision is the selected scan-reading strategy; local OCR remains a future alternative if offline use or fine-grained location is needed.
- Keep first-slice Q&A lexical. No embeddings/vector store is needed.
- A PDF parse can partially succeed; affected vision pages show warnings and successful pages remain usable.
- No consistency review runs automatically after the overview.

## Delivery Order

1. Classify PDF pages and retain native extraction metadata.
2. Render scans to image content and read them with Pi vision; store page-level text blocks.
3. Add the overview skill and source-aware lexical Q&A tool.
4. Remove the mandatory review sequence from the Pi prompt and connect scoped tools.
5. Add bounded concurrent reading and the Web overview/Q&A experience.
6. Verify text-native, scanned, mixed, unsupported, malformed, no-evidence, and partial-failure paths end to end.
7. Keep review as an optional later capability.
