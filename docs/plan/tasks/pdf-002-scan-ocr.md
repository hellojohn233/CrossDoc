---
id: pdf-002
scope: pdf-scan-ocr
status: done
depends-on: [pdf-001]
---

# Objective

Add bounded PNG rendering for a requested PDF page. Return PNG bytes plus page dimensions; the later request-scoped agent tool validates scan classification and wraps those bytes as Pi image content. Saving recognized page text into the request's parsed document is owned by `agent-001`; this task owns only the renderer and its output contract.

# Decision Gate

Use Pi vision, selected by the user. Keep image rendering behind a small loader/tool boundary so local OCR can replace it later. Citations for scan text are page-level; do not fabricate per-word rectangles.

# Context

- `docs/modules/pdf-reading.md`
- `docs/architecture.md`
- `src/loaders/pdf.ts`
- `src/loaders/render-pdf-page.ts`
- `src/core/claims.ts`
- `src/markdown/document.ts`

# Path

- `src/loaders/pdf.ts`
- `src/loaders/render-pdf-page.ts`
- `src/loaders/**`
- `src/core/claims.ts`
- `src/markdown/document.ts`
- `package.json` / lockfile for `@napi-rs/canvas`
- `scripts/verify-pdf-page-render.mjs`
- `docs/modules/pdf-reading.md`
- `docs/architecture.md`

# Verification

- A requested page can be rendered to PNG bytes at the documented bounded resolution.
- Rendering uses the real PDF renderer and returns valid PNG data plus page dimensions that Pi can wrap as `ImageContent`.
- Rotated/cropped pages render as the page appears in a normal viewer.
- Render errors are typed/actionable, and other pages remain readable.
- Run typecheck and focused render contract tests.
