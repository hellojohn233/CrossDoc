# CrossDoc Architecture

CrossDoc keeps format-specific reading separate from review logic and presentation:

- **Loaders** read source files and return the shared document structure.
- **Core** defines documents, positioned text blocks, claims, and conflicts.
- **Review tools** extract claims, compare them, verify candidates, and build evidence.
- **Markdown renderers** turn parsed documents and review results into readable Markdown.
- **Storage** persists the structured JSON before the UI displays the Markdown.
- **Web and CLI** are entry points; **Pi** provides an optional agent runtime.

## Data Flow

```text
PDF / DOCX / XLSX / image
  -> format loader
  -> normalized document JSON with source locations
  -> claim extraction with source-block references
  -> compare and verify
  -> review JSON + Markdown renderers
  -> Web UI citations open the original source
```

The first connected loader is PDF. It stores page text blocks with PDF user-space bounding boxes. The Web preview opens the cited page and overlays the captured text rectangles. Pages without selectable text receive a warning because OCR has not been connected yet.

## Shared Document Contract

`src/core/claims.ts` defines the current document contract:

- A document has a stable ID, format, pages, full text, positioned blocks, and converted Markdown.
- Each block has a stable ID, text offsets, and a source location.
- Claims retain evidence spans that reference the source block IDs and locations.
- Local filesystem paths stay in the server/storage layer and are not included in the normalized document JSON.

The PDF source location contains the page number, a rectangle `[left, bottom, right, top]`, and the visible page bounds in PDF user coordinates. Future loaders can add DOCX paragraph/table positions, XLSX sheet/range positions, and image/OCR pixel rectangles under the same source-location field.

## Markdown and Storage

`src/markdown/document.ts` renders parsed content and source footnotes. `src/markdown/review-report.ts` renders findings and evidence citations. `src/storage/review-store.ts` saves:

- `review.json` and `review.md`
- one JSON and Markdown pair per parsed document

The CLI writes these under `crossdoc-output/`. The Web server writes each run under `.crossdoc/reviews/<review-id>/` and keeps uploaded PDFs under `.crossdoc/uploads/` so citations can reopen them.

## Pi Boundary

`src/agent.ts` exports `createCrossDocTools()` and `createCrossDocAgent()`. The loaders, core model, Markdown renderers, and review pipeline do not import Pi. Pi remains the runtime loop, model abstraction, and tool scheduler.
