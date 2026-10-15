# PDF Reading: Text Pages, Scans, Overview, and Q&A

## Goal

Make the PDF path useful from selection through follow-up questions. A PDF may contain selectable text, scanned images, or both. CrossDoc must normalize all readable pages into source-aware Markdown, create a short overview after reading, and answer follow-up questions with page citations.

## Page-Level Classification

Classification happens per page, not per file:

| Page class | Signal | Processing | Provenance |
|---|---|---|---|
| Text-native | PDF.js finds a meaningful amount of selectable text | Extract text items in reading order | Existing PDF-space text item bounding boxes |
| Scan | Page has no or too little meaningful selectable text, but has visible page content | Render page to an image and ask Pi vision to read it | Page-level source location |
| Blank/unknown | No meaningful text and no vision-recognized content | Preserve an empty page and emit a warning only when appropriate | Page number; no fabricated block location |

The first implementation classifies a page as text-native when it has at least 8 non-whitespace characters or the combined non-empty text item bounding-box area is at least 0.1% of the visible page area. If it falls below both thresholds, PDF paint/image operators determine whether it is a scan candidate; a page without those signals is blank/unknown. Record the per-page classification and extraction method on the parsed page so later overview and Q&A steps can disclose vision-read content. A mixed PDF can therefore use both paths without special handling by the user.

Native text blocks retain PDF-space bounding boxes. A scan-candidate page can still contain sparse selectable text, so the vision transcript is appended as a separate page-level block without replacing its existing text or blocks. Vision blocks use stable IDs and page bounds; do not invent word/line boxes from a model response. Identical save retries reuse the existing vision block and do not append duplicate text.

## Scan Reading with Pi Vision

The chosen first implementation uses the configured Pi vision model for scan pages. A PDF rendering helper accepts a source path and one-based page number, then returns PNG bytes and the encoded image's pixel width and height. It renders at a fixed 1.5 scale using the PDF page viewport, which applies the page's CropBox and rotation. If either rendered side would exceed 4,500 pixels, it returns a typed size-limit error before allocating the page canvas. Invalid page numbers, unreadable sources, and render failures also return actionable typed errors. The request-scoped Pi tool only allows pages previously classified as scan candidates, then wraps those bytes as image content. The agent reads each rendered page, then submits recognized text through a scoped save tool so it becomes normal searchable Markdown. Pi tool results support image content, while `unpdf.renderPageAsImage` can render pages in Node when `@napi-rs/canvas` is available ([unpdf rendering API](https://github.com/unjs/unpdf#renderpageasimage), [Pi image content reference](https://github.com/mudrii/pi-mono-docs/blob/main/03-pi-agent-core.md#attachments)).

`parse_document` returns source-aware page Markdown to the model so an overview can use native text. Bound normalized content returned across selected documents to 80,000 characters per read turn, divided evenly by selected document count. Each document result reports whether its page-aware Markdown was truncated to its allocation. Request scope retains the full parsed document; `search_document` searches all of it regardless of the model-context budget. `save_scan_page_text` returns the saved page text, stable block ID, and page number so the active overview can use newly vision-read content.

The first version guarantees page-level citation for vision-read text. It retains page bounds and extraction method, but does not fabricate line-level OCR boxes. Render at a fixed 1.5 scale and reject pages whose rendered side would exceed 4,500 pixels. Process one page image per tool call to bound image tokens. Unsupported vision models and failed page reads become explicit page warnings. Local OCR can be added later behind the same scan-page boundary if stronger geometry or offline operation becomes necessary.

Use Pi AI's registered built-in providers and resolve one explicit model from `CROSSDOC_VISION_MODEL` in `provider/model-id` form. The selected chat model must be authenticated and advertise both text and image input. Use this same model for scan reading, overview, and follow-up answers in the first slice. If the variable is missing, the provider is unauthenticated, the model does not exist, or the model lacks image input, fail before accepting a reading job with a specific setup message. Do not instantiate an empty `createModels()` collection and assume the Pi CLI's model settings are available inside this embedded runtime.

## Normalized Markdown and Source Navigation

- Keep the existing page headings and source footnotes.
- Every extracted native or vision-read block receives a stable block ID and source reference. Vision-read blocks have page-level provenance in the first version.
- Source notes include the archived document title and a page link to `/api/library/<id>/source#page=<page>`.
- Store original PDF, normalized `document.md`, and metadata together under `data/library/<document-id>/`.
- Keep vision/text-layer method and page classification in metadata; avoid cluttering normal body text with parser jargon.
- In the first UI, a citation opens the exact PDF page. Bounding boxes stay available for later highlight/crop navigation; do not claim the browser PDF viewer can highlight an arbitrary rectangle consistently.

## Overview Skill

After the selected PDFs finish parsing and are archived, the agent loads a small `document-overview` skill and generates an initial response. The skill asks for:

- A one-sentence description of what the document is about.
- A short outline of its structure and main points.
- Important dates, amounts, obligations, or named entities only when salient to the document.
- OCR uncertainty or unreadable sections when present.
- Page citations for factual statements.

Keep the output concise and do not run claim comparison or consistency review as part of this default step. The overview consumes the same normalized content whether a page used native extraction or OCR.

## Follow-Up Questions

Keep the Pi agent session and parsed document IDs available for follow-up. Provide a scoped `search_document` tool that searches normalized page blocks using simple lexical matching and returns a small set of relevant excerpts with block IDs, pages, and source locations. The retrieval utility validates runtime inputs, caps the query at 500 characters, caps the document scope at 32 documents, and returns no more than eight excerpts of 420 characters each. The agent answers from these excerpts and cites the source page. If retrieval finds no support, it says the selected material does not establish the answer and can ask the user to narrow the question. Do not add embeddings/vector storage to this first slice.

The first UI needs a concise initial overview, a question input after reading, streaming/progress state, and citations that open the archived PDF page. A source page link is `/api/library/<id>/source#page=<n>`.

### Reading page layout

```text
┌─────────────────────────────────────────────────────────┐
│ CrossDoc                                      资料库入口 │
├─────────────────────────────────────────────────────────┤
│ 文件列表 / 目录树             │ 阅读结果                 │
│                               │                          │
│ selected.pdf                  │ 简短概述                 │
│ selected-scan.pdf             │ · 内容主题 [第 1 页]      │
│                               │ · 主要章节 [第 2–4 页]    │
│                               │                          │
│                               │ ──────────────────────── │
│                               │ 继续提问…          [发送] │
└─────────────────────────────────────────────────────────┘
```

Before reading, keep the existing clean file/folder selection surface. After reading starts, show extraction/OCR progress in the result region. Render the overview before the question input. Each citation opens the corresponding archived PDF page. On narrow screens, stack the file list above the result region.

## Failure Behavior

- Text-native extraction can succeed even when some pages require OCR.
- Vision failure is attached to the affected page; valid pages remain available.
- The agent states which pages are unreadable or vision-read when relevant.
- Unsupported vision model, page-render failure, corrupt PDF, and empty/unreadable page output are explicit warnings/errors.
- A parse failure in one selected PDF does not discard other successfully parsed PDFs.

## Acceptance Scenario

Select a text-native PDF, a scanned PDF, and a mixed PDF. CrossDoc identifies page types, creates source-aware Markdown with page/block locations, stores source plus Markdown in the local library, and produces a concise overview with page citations. Ask a follow-up question whose answer appears on a known page; the answer cites and opens that exact page. Ask something not present in the documents; the agent does not invent an answer. Vision errors appear against affected pages without erasing extracted content from other pages.

## Implementation Boundary

This module completes the PDF reader slice. DOCX/XLSX/image loaders, vector retrieval, source-region highlighting, and automatic consistency review remain separate follow-up work.
