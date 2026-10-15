---
name: pdf-reading
description: Read text-native and scanned PDF pages with page-level provenance.
---

# PDF reading

Use the PDF tools for documents selected in this request. Do not use paths from the conversation or invent document IDs.

1. Call `inspect_document` to identify the document and page classifications.
2. Call `parse_document` to extract selectable text and create the normalized Markdown artifact.
3. For each page listed as a scan candidate, call `render_scan_page` for that page only. The tool calls the configured vision model, saves its exact transcript as a page-cited block, and returns the saved text. Do not relay the transcript through `save_scan_page_text`.
4. If a page is unreadable, the scan tool returns an error and leaves the page unsaved. Do not guess text; report that page number and the warning.
5. Treat every extracted statement as evidence tied to its document and PDF page. Vision-read text has page-level location only; do not claim a line or word position.

After a normal reading request, load `document-overview` and give the concise cited overview it describes. Do not run claim extraction or consistency review unless requested.
