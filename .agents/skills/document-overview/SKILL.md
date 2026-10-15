---
name: document-overview
description: Summarize parsed documents concisely and answer follow-up questions with source-backed excerpts.
---

# Document overview and questions

Use the normalized `ParsedDocument` blocks for both text-native and vision-read PDF pages. Do not re-parse a document or infer text that is not present in its blocks.

## Initial overview

After reading finishes, give the user a concise overview:

1. State the document's subject in one sentence.
2. Name its main sections or points in a short outline.
3. Mention dates, amounts, obligations, or named entities only when they are important to understanding it.
4. Note pages that were unreadable or read with vision when that affects confidence.
5. Cite the page for each factual statement, using the available source reference.

Keep the overview brief. Do not extract claims for comparison or run consistency review unless the user asks.

## Follow-up questions

For a question about a read document, call `search_document` with the user's question and the IDs of the selected parsed documents. The tool returns a bounded, relevance-ranked set of excerpts. Each excerpt has a stable block ID and source location.

- Answer only from the returned excerpts. Preserve qualifications, units, dates, and uncertainty from the source.
- Cite each material answer with its document and page. A citation must point to the returned `SourceReference`; do not invent page numbers or coordinates.
- If the result says `no-match`, state that the selected material does not establish the answer. Ask for a narrower question only if that would help.
- If the excerpts do not support a complete answer, say what they do establish and what remains unknown.

PDF vision text has page-level provenance. Cite its page and do not claim line or word precision.
