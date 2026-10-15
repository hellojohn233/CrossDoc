---
id: pdf-002
scope: pdf-scan-ocr
status: in-progress
depends-on: [pdf-001]
---

# Objective

Render only pages classified as scan candidates, let the configured Pi vision model read them, save recognized text as normalized page-level blocks, and preserve per-page warnings on partial failure.

# Decision Gate

Use Pi vision, selected by the user. Keep image rendering behind a small loader/tool boundary so local OCR can replace it later. Citations for scan text are page-level; do not fabricate per-word rectangles.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/loaders/pdf.ts`
- `src/core/claims.ts`
- `src/markdown/document.ts`

# Path

- `src/loaders/pdf.ts`
- `src/loaders/**`
- `src/core/claims.ts`
- `src/markdown/document.ts`
- `package.json` / lockfile only if the selected engine requires it
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- A scanned fixture is rendered and returned as image content to the configured vision model.
- Vision-extracted content is stored as searchable text blocks with stable IDs and page-level source locations.
- Mixed PDFs retain native extraction on text pages and OCR on scan pages.
- Vision-model or render failure is visible as a page warning, while other pages remain readable.
- Run typecheck and focused scan-page/Markdown tests.
