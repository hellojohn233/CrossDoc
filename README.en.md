# CrossDoc

<p align="center">
  <img src="./public/crossdoc-logo.svg" alt="CrossDoc" width="72" height="62" />
</p>

[中文](./README.md) | English

CrossDoc — an evidence-grounded document consistency review agent, built on Pi.

CrossDoc is not a Pi demo. Pi is the minimal agent runtime; CrossDoc is the domain system around multi-document consistency review: parse, extract, compare, verify, and report contradictions with evidence.

> What the mark means: the two deep-ink blocks are two documents, the blue bar running across them is the line that **agrees** once the documents are aligned, and the broken amber bar is the line that **conflicts**. The vector source lives in [`public/crossdoc-logo.svg`](./public/crossdoc-logo.svg).

## Core Idea

1. **Document consistency review**: discover contradictions, preserve evidence, and make results traceable and evaluable.
2. **Pi Agent runtime**: use `@earendil-works/pi-agent-core` for the agent loop and `@earendil-works/pi-ai` for model access instead of writing a custom loop.

Design principle:

> CrossDoc uses Pi as the minimal runtime harness and concentrates its engineering effort on the domain problem Pi does not solve directly: false-positive control, evidence traceability, and evaluability for multi-document consistency review.

## Why This Shape

Pi is the engine; consistency review is the vehicle.

The review pipeline is owned by CrossDoc:

- `parse_doc`: use a format loader to produce normalized JSON with source positions.
- `extract_claims`: convert document text into reviewable claims.
- `compare_claims`: find candidate contradictions across documents.
- `verify_conflicts`: demote weak matches and keep false positives under control.
- `report_conflicts`: render a Markdown report with source citations from structured review data.

Each extracted text block keeps a source ID and location. PDF pages are classified as selectable text or scans: native text retains PDF coordinates, while Pi vision reads scan pages with page-level provenance. A citation opens the corresponding PDF page; scan text has page-level location in this first version.

Pi is used only as the runtime boundary:

- agent loop
- model provider abstraction
- tool registration and execution

## Quick Start

Install dependencies:

```bash
npm install
```

Run a deterministic local review without an LLM:

```bash
npm run dev -- review "./examples/docs/*.pdf"
```

The CLI writes `review.json` and `review.md` under `crossdoc-output/`, plus structured JSON and source-footnoted Markdown for each document under `documents/`.

`examples/docs/` holds three rebuildable sample contracts (two revisions plus one that repeats the same boilerplate clause) for demonstrating document conversion and consistency review. Regenerate them with:

```bash
npm run examples:generate
```

Build:

```bash
npm run build
```

After build, the CLI entry is:

```bash
node dist/cli.js review "./examples/docs/*.pdf"
```

Model profiles are configured in the web UI, not through environment variables. Open the `模型配置` / model configuration tab in the header and set the main model and the scan-page vision model separately; the settings are stored in the local `data/crossdoc.sqlite` together with the API key. Configuration never blocks browsing — you can still enter the app and browse the library — but starting a read needs the main model. The vision model must support image input; the main model may be text-only. This is a single-user local app: the web server binds to `127.0.0.1` only, and the API key is stored as plaintext in that SQLite file. Start the Web UI:

```bash
npm run dev:web
```

Then open:

```text
http://localhost:5177
```

The Web UI is the reading surface: upload PDFs, let the Pi Agent parse them by file format, read scanned pages with the vision model, then produce a short overview and answer follow-up questions in the same session. Reading progress is sent as replayable SSE events, and citations open the archived PDF at the cited page. The deterministic consistency review stays available on its own `/api/review` route.

The header is the only navigation entry point, with three tabs: `上传` / `资料库` / `模型配置`. The active tab carries `aria-current="page"`.

Uploads are staged in `.crossdoc/uploads/`; review JSON and Markdown are kept in `.crossdoc/reviews/`. Successfully reviewed documents are also archived locally in `data/library/<document ID>/` with `source.pdf`, `document.md`, and `metadata.json`. The local data directory is ignored by Git. The library tab lists archived documents; the upload tab never previews them.

## Pi Version Discipline

This project uses npm dependencies, not a forked Pi checkout.

Compatible baseline:

- `@earendil-works/pi-agent-core`: `^1.2.0`
- `@earendil-works/pi-ai`: `^1.2.0`

`package-lock.json` is committed so transitive dependency changes stay reviewable.

## Project Layout

```text
CrossDoc/
├── package.json
├── public/
│   ├── crossdoc-logo.svg
│   └── index.html
├── src/
│   ├── agent.ts
│   ├── cli.ts
│   ├── core/
│   │   ├── claims.ts
│   │   └── types.ts
│   ├── loaders/
│   │   ├── index.ts
│   │   ├── pdf-line-blocks.ts
│   │   ├── pdf.ts
│   │   └── types.ts
│   ├── markdown/
│   │   ├── document.ts
│   │   └── review-report.ts
│   ├── storage/
│   │   ├── library-store.ts
│   │   └── review-store.ts
│   └── tools/
│       ├── compare.ts
│       ├── extract.ts
│       ├── parse.ts
│       ├── report.ts
│       └── verify.ts
└── examples/
    └── docs/
```

## Current Status

Current data flow:

- `loaders/` reads each format into the shared structure defined in `core/`; PDF is connected first.
- PDF text blocks are **line**-level: they keep page coordinates, and extracted claims point back to those source blocks.
- A scanned page's vision transcript is split into line blocks as well, but keeps page-level location and never claims a line box.
- `markdown/` renders per-document Markdown and the final review report separately; source notes are keyed by source position, so a native line gets its own note and a scanned page is cited once.
- `storage/` writes JSON and Markdown before the UI presents the results.
- Scanned PDF pages are read by the configured Pi vision model; DOCX/XLSX loaders are not connected yet.
- Claim extraction is deterministic and intentionally conservative.
- Comparison and verification are rule-based placeholders.
- Pi wiring remains isolated in `src/agent.ts`; parsing and report generation do not depend on Pi.

The request-scoped Pi Agent, the automatic overview, and follow-up questions with source-page citations are connected. Next steps are the DOCX/XLSX loaders and a request-scoped review skill.

## Acknowledgements

CrossDoc is built on Pi's minimal agent harness and extension philosophy. Respect and thanks to the Pi project and its maintainers:

- Pi official source: https://github.com/earendil-works/pi
