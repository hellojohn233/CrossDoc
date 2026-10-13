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

- `parse_doc`: parse local PDFs into page-grounded text.
- `extract_claims`: convert document text into reviewable claims.
- `compare_claims`: find candidate contradictions across documents.
- `verify_conflicts`: demote weak matches and keep false positives under control.
- `report_conflicts`: emit a traceable Markdown report with evidence.

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

Build:

```bash
npm run build
```

After build, the CLI entry is:

```bash
node dist/cli.js review "./examples/docs/*.pdf"
```

Start the minimal Web UI:

```bash
npm run dev:web
```

Then open:

```text
http://localhost:5177
```

The Web UI is only a local visual entry point: upload PDFs, run the same review pipeline, and inspect findings plus the Markdown report. Review capability still lives in `src/review.ts`, `src/tools/`, and `src/core/`; the Pi agent runtime remains isolated in `src/agent.ts`.

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

This is the first development skeleton:

- PDF parsing uses `unpdf`.
- Claim extraction is deterministic and intentionally conservative.
- Comparison and verification are rule-based placeholders.
- Pi wiring is isolated in `src/agent.ts` so model/provider choices do not leak into review logic.

Next step: replace the deterministic claim extractor with a Pi tool-backed LLM extraction pass while keeping the same `Claim` and `Conflict` contracts.

## Acknowledgements

CrossDoc is built on Pi's minimal agent harness and extension philosophy. Respect and thanks to the Pi project and its maintainers:

- Pi official source: https://github.com/earendil-works/pi
