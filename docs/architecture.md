# CrossDoc Architecture

CrossDoc uses Pi's small agent runtime as an engine and adds only the document capabilities the product needs. Pi owns the agent loop, model streaming, tool execution, and parallel execution of tool calls. CrossDoc owns file access, format detection, format-specific loaders, skill routing, source locations, and local artifacts.

## Runtime Boundary

The project uses `@earendil-works/pi-agent-core`, not the complete Pi Coding Agent CLI. Do not assume CLI facilities such as built-in filesystem tools or automatic skill discovery exist in the embedded runtime. CrossDoc supplies its own narrowly scoped tools and loads only the skill instructions needed for the current documents.

Skills are instructions for choosing and using document capabilities. Loaders are executable format adapters that do the parsing. A skill may guide the agent to use a loader, but it cannot replace the loader's source-location contract.

## Agent-Directed Data Flow

```text
User task + selected files
  -> CrossDoc scopes the available files
  -> inspect_document identifies the format
  -> agent loads the matching format/task skill
  -> format loader extracts text and source locations
       └─ PDF loader classifies pages individually as text-native or scan
             └─ scan pages go through the selected OCR adapter
  -> loader returns normalized blocks + source locations + Markdown
  -> CrossDoc archives source + Markdown in data/library/<document-id>/
  -> agent runs the document-overview skill for the initial reading response
  -> user can ask follow-up questions grounded in retrieved blocks
  -> agent optionally compares / verifies / reports when the user asks
```

There is no required `parse -> extract -> compare -> verify -> report` chain. The agent selects tools based on the user task. Consistency review is an optional capability, not the only way to use the documents.

## Agent and Tool Responsibilities

| Area | Owns | Does not own |
|---|---|---|
| Pi Agent Core | Agent loop, model stream, transcript, tool scheduling, tool-call concurrency | CrossDoc document formats, library rules, review policy |
| CrossDoc agent adapter | Base prompt, scoped tools, format-to-skill routing, operation progress | Hard-coded end-to-end review order |
| Format detector | File signature/extension evidence and detected format | Parsing document contents |
| Skills | On-demand instructions and format-specific reading guidance | Executable parser implementation or source coordinate fabrication |
| Loaders | Format parsing, normalized blocks, page/sheet/paragraph locations, Markdown | User intent or whether to compare documents |
| Optional review tools | Claim extraction, comparison, verification, report rendering | Mandatory orchestration for every task |
| Library storage | Original source, normalized Markdown, and metadata under `data/library/` | Database, remote sync, or review decisions |

The server passes the agent only the files selected for the current task. Agent tools resolve document IDs through that scope; model-provided arbitrary filesystem paths are not accepted as document input.

## PDF Reading Slice

PDFs are classified per page, because a single file may mix selectable text and scanned pages. Text-native pages use PDF.js text items and their PDF-space bounding boxes. Scan pages are rendered as PNG at scale 1.5 and passed to Pi vision; the renderer respects page rotation and CropBox and rejects output sides above 4,500 pixels. Vision-read text has page-level provenance; it does not receive fabricated word or line boxes. The common `ParsedDocument` contract and Markdown renderer are used for both. A blank page remains blank and is not mislabeled as a vision-read failure.

The first reader path invokes a concise overview skill after the selected PDFs have been parsed and archived. The skill explains the document's topic, structure, key points, and any extraction uncertainty, with page citations. Follow-up Q&A retrieves relevant normalized blocks from the selected/library documents and requires the answer to cite their source pages. The first slice uses bounded lexical retrieval over parsed blocks; it does not require a vector database, and it does not run consistency review unless requested.

For browser navigation, a PDF citation opens the archived original with `#page=<n>`. The parser retains block bounding boxes for future in-page highlighting; initial navigation guarantees the correct page, while exact PDF viewer coordinate highlighting is viewer-dependent.

The OCR adapter is an explicit implementation choice in [the PDF reading design](./modules/pdf-reading.md). OCR failure, unsupported language data, or unusable scan output must be visible in document warnings and in the reading response, never silently converted to an empty document.

## Document Contract and Provenance

`src/core/claims.ts` defines the shared parsed-document contract:

- A document has a stable ID, format, pages, full text, positioned blocks, Markdown, and warnings. PDF page/block metadata records whether text came from the native text layer or OCR.
- Each block retains a source location. PDF locations include page number and PDF coordinates; future DOCX, XLSX, and image loaders add format-appropriate locations.
- Claims, answers, and findings must cite source block IDs and locations when making document-grounded statements.
- Local filesystem paths stay in the server/storage boundary and are not included in normalized document data.

Markdown is a durable reading artifact, not the only representation. Structured blocks and locations remain available for precise citations and source-file navigation.

## Parallelism

Pi Agent Core can execute independent tool calls from one assistant response in parallel. CrossDoc marks safe, read-only document operations as parallel. If a request contains many files, CrossDoc applies a concurrency limit at the application boundary. Results are returned in input order even when workers finish out of order, and one file's parse failure does not erase successful documents.

Format inspection precedes format-specific skill selection. Once the formats and matching instructions are known, parsing calls for independent documents can run concurrently. Dependent operations remain sequential when they require earlier results.

## Markdown, Source Files, and Library

`src/markdown/document.ts` renders parsed content and source references. `src/storage/library-store.ts` stores successful imports at `data/library/<document-id>/`:

```text
data/library/<document-id>/
├── source.<original-extension>
├── document.md
└── metadata.json
```

The current connected format is PDF, so its source is saved as `source.pdf`. `data/` is local application data and is ignored by Git. Review runs may additionally create derived reports under `.crossdoc/reviews/` or `crossdoc-output/`.

## Current Implementation State

- PDF parsing is connected and keeps selectable-text page coordinates. The bounded PNG renderer for scan pages is available; Pi vision reading and saving its page text are the next integration steps.
- DOCX, XLSX, and image source-location types exist, but matching loaders and skills are not connected.
- The Web and CLI entry points still call the deterministic `reviewDocuments()` pipeline directly.
- `createCrossDocAgent()` currently registers parsing/review tools and its prompt prescribes a fixed order; it is not yet the Web request orchestrator.
- Local library storage saves source PDFs, parsed Markdown, and metadata under `data/library/`.

The delivery plan under `docs/plan/` first completes the PDF text/scan reading path, overview, and cited Q&A, then replaces the fixed review entry point with the broader agent-directed path.
