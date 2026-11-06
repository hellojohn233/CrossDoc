# Documentation Index

- [Architecture](./architecture.md): Pi boundary, agent-directed document flow, provenance, SQLite storage, separate model roles, and bounded concurrent parsing.
- [PDF reading design](./modules/pdf-reading.md): text-native and scanned pages, line-level blocks, source notes per source position, OCR options, overview, Q&A, and citations.
- [Web reading surface](./modules/web-reading.md): implemented selection, replayable reading progress, overview/Q&A, Library, review records, cancellation, citation links, and the content-grouped Library list.
- [Local storage and model configuration](./modules/local-storage-and-models.md): SQLite library index, structured artifacts, document identity by content, separate main/vision model roles.
- [Model setup layout](./modules/model-setup-layout.md): custom endpoint setup, model discovery, connection test, and header navigation.
- [Conflict ledger](./modules/conflict-ledger.md): single-column conflict list, A/B redline comparison, evidence links, severity and document filters, the document comparison panel, and the review contract the UI depends on.
- [Skills](./modules/skills.md): the Agent Skills format, discovery, progressive disclosure, deterministic invocation, and bundled reference files.
- [Review adjudication](./modules/review-adjudication.md): key data extraction, alignment by a fixed key vocabulary, language-model adjudication, and evidence verification.
- [Plan workflow](./plan/README.md): current implementation plan and delivery task index.
- [Agent-first reading analysis](./plan/analysis/agent-first-reading.md): module boundaries, integration paths, and phased scope.
