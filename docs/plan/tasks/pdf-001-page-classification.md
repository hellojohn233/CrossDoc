---
id: pdf-001
scope: pdf-ingestion
status: in-progress
depends-on: []
---

# Objective

Make PDF parsing classify each page independently as text-native, scan candidate, or blank/unknown. Preserve native PDF text items, reading order, and their PDF-space bounding boxes. Handle mixed-content PDFs without treating a whole file as a single type.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/loaders/pdf.ts`
- `src/core/claims.ts`
- `src/markdown/document.ts`

# Path

- `src/loaders/pdf.ts`
- `src/core/claims.ts` if page extraction method metadata is needed
- `src/markdown/document.ts`
- `src/loaders/**`
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- A text-native fixture produces the same positioned native text blocks and source-aware Markdown.
- A scan page is identified for the OCR stage instead of silently treated as an empty successful page.
- A blank page is distinguishable from a scan candidate where PDF evidence allows it.
- Mixed native/scan PDFs retain page order and per-page extraction method.
- Run typecheck and focused PDF loader tests.
