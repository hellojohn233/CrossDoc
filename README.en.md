# CrossDoc

[中文](./README.md) | English

CrossDoc — an evidence-grounded document consistency review agent, built on Pi.

CrossDoc is not a Pi demo. Pi is the minimal agent runtime; CrossDoc is the domain system around multi-document consistency review: parse, extract, compare, verify, and report contradictions with evidence.

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

Build:

```bash
npm run build
```

After build, the CLI entry is:

```bash
node dist/cli.js review "./examples/docs/*.pdf"
```

Configure credentials for the selected Pi AI provider first (the example model uses `GOOGLE_API_KEY`) and set an image input model. Pi Agent creation fails before reading starts if the model setting is absent, the model is missing from Pi AI's built-in catalog, provider credentials are missing, or the model does not support images. See `.env.example` for the configuration shape. Start the Web UI:

```bash
export CROSSDOC_VISION_MODEL=google/gemini-2.5-flash
export GOOGLE_API_KEY=your-key
npm run dev:web
```

Then open:

```text
http://localhost:5177
```

The Web UI is a local visual entry point: upload PDFs, run the same review pipeline, inspect findings and the Markdown report, and click citations to open the source PDF page. Uploads are staged in `.crossdoc/uploads/`; review JSON and Markdown are kept in `.crossdoc/reviews/`. Successfully reviewed documents are also archived locally in `data/library/<document ID>/` with `source.pdf`, `document.md`, and `metadata.json`. The local data directory is ignored by Git. The start page only shows a library entry point; document listings live on the separate library page.

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
├── src/
│   ├── agent.ts
│   ├── cli.ts
│   ├── core/
│   │   ├── claims.ts
│   │   └── types.ts
│   ├── loaders/
│   │   ├── index.ts
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
- PDF text blocks keep page coordinates, and extracted claims point back to those source blocks.
- `markdown/` renders per-document Markdown and the final review report separately.
- `storage/` writes JSON and Markdown before the UI presents the results.
- Scanned PDF pages are read by the configured Pi vision model; DOCX/XLSX loaders are not connected yet.
- Claim extraction is deterministic and intentionally conservative.
- Comparison and verification are rule-based placeholders.
- Pi wiring remains isolated in `src/agent.ts`; parsing and report generation do not depend on Pi.

Next step: connect the request-scoped Pi Agent to the Web reading surface, show its automatic overview, and support follow-up questions with source-page citations.

## Acknowledgements

CrossDoc is built on Pi's minimal agent harness and extension philosophy. Respect and thanks to the Pi project and its maintainers:

- Pi official source: https://github.com/earendil-works/pi
