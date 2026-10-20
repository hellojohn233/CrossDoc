---
id: ingest-001
scope: document-block-granularity
status: done
depends-on: [pdf-001]
---

# Objective

Store every page as line-level blocks and render Markdown source notes per source position. PDF.js reports one text item per positioned run, which is a single word for many producers; one block per item produced a footnote per word, cut words in half in the Markdown artifact, and made a multi-term query impossible to match inside a single block. This task owns the block granularity of both reading paths: native text lines and vision-read transcript lines.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/core/claims.ts`
- `src/markdown/document.ts`
- `src/markdown/source-location.ts`
- `src/loaders/pdf.ts`
- `src/agent.ts`

# Path

- `src/loaders/pdf-line-blocks.ts`
- `src/loaders/pdf.ts`
- `src/markdown/document.ts`
- `src/markdown/source-location.ts`
- `src/agent.ts`
- `scripts/lib/pdf-fixture.mjs`
- `scripts/verify-document-ingest.mjs`
- `scripts/verify-scan-page-blocks.mjs`
- `scripts/generate-examples.mjs`
- `examples/docs/**`
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- Native text items that share a baseline become one block whose box is the union of the grouped item boxes, and every block is a contiguous slice of the page text.
- A block identifier is `<document-id>:p<page>:b<line-index+1>`; the first block of a page stays `:p1:b1`.
- A vision transcript becomes one block per transcript line, and every vision block keeps page-level location without claiming a line box.
- Markdown source notes are keyed by source position: a text-native line gets its own note, a scanned page is cited once, and a page-level citation never shows a text box.
- A page read by the vision model says so in the Markdown artifact.
- Saving the same transcript again reuses the stored blocks, and a different transcript on the same page is refused.
- The page classification thresholds, the page bounds, the warnings, and the block order are unchanged.
- Run typecheck, the focused ingest and scan-page verification scripts, and the existing verification scripts.
