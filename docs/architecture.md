# CrossDoc Architecture

CrossDoc uses Pi's small agent runtime as an engine and adds only the document capabilities the product needs. Pi owns the agent loop, model streaming, tool execution, and parallel execution of tool calls. CrossDoc owns file access, format detection, format-specific loaders, skill routing, source locations, and local artifacts.

## Runtime Boundary

The project uses `@earendil-works/pi-agent-core`, not the complete Pi Coding Agent CLI. Do not assume CLI facilities such as built-in filesystem tools or automatic skill discovery exist in the embedded runtime. CrossDoc supplies its own narrowly scoped tools and loads only the skill instructions needed for the current documents. Legacy catalog profiles use Pi AI's built-in providers and can resolve either a saved key or Pi's ambient provider credential. New custom profiles register the selected Pi API adapter from their saved protocol, Base URL, model ID, and key. Main and vision profiles are stored independently in local SQLite. The main chat model may be text-only. Only the scoped scan-page tool sends a rendered page to the configured vision model; for custom endpoints, the user selects a model ID whose provider supports image input because CrossDoc cannot establish that capability from a generic model list.

Skills are instructions for choosing and using document capabilities. Loaders are executable format adapters that do the parsing. A skill may guide the agent to use a loader, but it cannot replace the loader's source-location contract.

## Agent-Directed Data Flow

```text
User task + selected files
  -> CrossDoc scopes the available files
  -> inspect_document identifies the format
  -> agent loads the matching format/task skill
  -> format loader extracts text and source locations
       └─ PDF loader classifies pages individually as text-native or scan
             └─ scan tool sends one rendered page to the separate Pi AI vision model
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
| Library storage | Original source and derived JSON/Markdown files under `data/library/`; SQLite document index and settings | Remote sync or review decisions |

The server passes the agent only the files selected for the current task. Agent tools resolve document IDs through that scope; model-provided arbitrary filesystem paths are not accepted as document input.

## PDF Reading Slice

PDFs are classified per page, because a single file may mix selectable text and scanned pages. Text-native pages use PDF.js text items and their PDF-space bounding boxes. Scan pages are rendered as PNG at scale 1.5 and sent one at a time to the separately configured Pi AI vision model with `Models.completeSimple()`; the main Agent sees the transcript, not the image. The renderer respects page rotation and CropBox and rejects output sides above 4,500 pixels. Vision-read text has page-level provenance; it does not receive fabricated word or line boxes. The common `ParsedDocument` contract and Markdown renderer are used for both. A blank page remains blank and is not mislabeled as a vision-read failure.

The first reader path invokes a concise overview skill after the selected PDFs have been parsed and archived. The skill explains the document's topic, structure, key points, and any extraction uncertainty, with page citations. Follow-up Q&A retrieves relevant normalized blocks from the selected/library documents and requires the answer to cite their source pages. The first slice uses bounded lexical retrieval over parsed blocks; it does not require a vector database, and it does not run consistency review unless requested.

For browser navigation, a PDF citation opens the archived original with `#page=<n>`. The parser retains block bounding boxes for future in-page highlighting; initial navigation guarantees the correct page, while exact PDF viewer coordinate highlighting is viewer-dependent.

The Web reading lifecycle is hosted in `src/server.ts`. `POST /api/read` stages a bounded multipart selection, assigns opaque UUIDs, validates PDF signatures, and creates one request-scoped Pi Agent. A session holds its Agent, parsed-document scope, ordered per-file states, and monotonically numbered SSE events in memory. Reconnecting with `Last-Event-ID` replays only newer events; if the cursor predates the 500-event ring, the server sends current document, overview, recent-answer, and completion snapshots. Reconnecting never starts another prompt. Each accepted session starts one read prompt, and follow-up questions are admitted only while the Agent is idle, then sent to that same Agent. Cancellation aborts the active run; cancelling a later question emits its own error/progress result and a terminal cancelled event. Successfully parsed documents are archived through the agent persistence callback; staged upload files are removed when the run settles, including invalid or failed inputs.

Session memory has finite retention: at most six sessions, a 60-minute idle TTL, a four-hour absolute lifetime, and 30 accepted follow-up questions per session. The server retains at most 500 SSE events, capped at 256 KiB per session and 4 MiB process-wide, plus 10 answer snapshots per session; displayed assistant text is capped at 12,000 characters. Web parse-plus-archive concurrency is capped at three across the process, total uploads at 100 MiB per session, and extracted text at 1,000,000 characters per document / 2,000,000 per session. At session capacity it evicts the least recently active idle session or rejects a new read with HTTP 503 if all sessions are busy. A file is marked ready only after parsing and the Library persistence callback both succeed. Session restart/expiry only removes in-memory Agent and parsed state; archived Library files remain durable.

The reading page is the primary Web route. It shows a compact ordered file status list beside the overview and follow-up conversation. The deterministic `/api/review` endpoint remains available as a separate optional capability. Model-generated text is HTML-escaped before citation tokens are converted into page links; a token is linked only when its document UUID belongs to the active session and its page is a positive integer.

The OCR adapter is an explicit implementation choice in [the PDF reading design](./modules/pdf-reading.md). OCR failure, unsupported language data, or unusable scan output must be visible in document warnings and in the reading response, never silently converted to an empty document.

Local library and model configuration are specified in [local storage and model configuration](./modules/local-storage-and-models.md). `data/crossdoc.sqlite` indexes relative paths to source PDFs, canonical structured `document.json`, and rendered `document.md`; it also stores single-user app settings and the plaintext main/vision model profiles. Production HTTP binds to loopback (`127.0.0.1`) only; settings rely on this local-only boundary and have no user authentication. `GET /api/settings` returns model IDs, whether a key is stored, and a non-sensitive `authAvailable` boolean; it never returns credentials. Legacy catalog settings are resolved against Pi AI's local model catalog and may use ambient provider credentials. New custom profiles bypass catalog lookup and use the selected OpenAI-compatible, Anthropic Messages, or Gemini adapter. Custom vision model image capability depends on the model ID selected by the user. Main streaming and one-page vision requests pass saved keys through request options; missing profile/auth setup is reported before the Agent starts a read. Startup imports legacy metadata records idempotently.

## Document Contract and Provenance

`src/core/claims.ts` defines the shared parsed-document contract:

- A document has a stable ID, format, pages, full text, positioned blocks, Markdown, and warnings. PDF page/block metadata records whether text came from the native text layer or OCR.
- Each block retains a source location. PDF locations include page number and PDF coordinates; future DOCX, XLSX, and image loaders add format-appropriate locations.
- `parse_document` gives the model source-aware Markdown within an 80,000-character per-read-turn budget divided evenly across selected documents. Request-scoped `ParsedDocument` values remain complete, and lexical search uses their full content. Saving a scan page returns its text and citation in the current tool result.
- Claims, answers, and findings must cite source block IDs and locations when making document-grounded statements.
- Local filesystem paths stay in the server/storage boundary and are not included in normalized document data.

Markdown is a durable reading artifact, not the only representation. Structured blocks and locations remain available for precise citations and source-file navigation.

## Parallelism

Pi Agent Core can execute independent tool calls from one assistant response in parallel. CrossDoc marks `parse_document` parallel and applies a semaphore cap of three across parse plus persistence work. Pi Core serializes an entire tool-call batch when any call in it has `executionMode: "sequential"`, so the agent sends independent parse calls together before scan-page rendering or saving. Pi returns tool-result messages in the assistant's call order even if the operations finish out of order. Each file reports its own parse or persistence error; successful documents remain parsed and archived.

Format inspection precedes format-specific skill selection. Once the formats and matching instructions are known, parsing calls for independent documents can run concurrently. Dependent operations remain sequential when they require earlier results.

## Markdown, Source Files, and Library

`src/markdown/document.ts` renders parsed content and source references. `src/storage/library-store.ts` stores successful imports at `data/library/<document-id>/`, indexed by `data/crossdoc.sqlite`:

```text
data/library/<document-id>/
├── source.<original-extension>
├── document.json
├── document.md
└── metadata.json (legacy import compatibility)
```

The current connected format is PDF, so its source is saved as `source.pdf`. `data/` is local application data and is ignored by Git. Review runs may additionally create derived reports under `.crossdoc/reviews/` or `crossdoc-output/`.

## Current Implementation State

- The request-scoped Pi Agent provides inspection, skill loading, PDF parsing, scan image rendering/transcription through a separate vision profile, vision text saving, and lexical search. Legacy main/vision profiles resolve through the local model catalog and can use ambient credentials; custom profiles register independent Pi API adapters. The main model may be text-only, and the user selects an image-capable custom vision model.
- DOCX, XLSX, and image source-location types exist, but matching loaders and skills are not connected.
- The Web reading entry point runs a request-scoped Pi Agent, streams progress through bounded replayable SSE, presents overview and Q&A, and archives parsed source/Markdown artifacts. `/api/review` and the CLI review command remain deterministic optional review paths.
- The agent adapter's source-bounded persistence callback is wired to the local Library. Web sessions retain the Pi transcript and parsed scope only in memory; a server restart ends active sessions while archived files remain.
- Local library storage saves source PDFs, canonical parsed JSON, and Markdown under `data/library/`; versioned SQLite migrations store the relative-path index and model/settings configuration, and import existing metadata records idempotently.

The delivery plan under `docs/plan/` first completes the PDF text/scan reading path, overview, and cited Q&A, then replaces the fixed review entry point with the broader agent-directed path.
