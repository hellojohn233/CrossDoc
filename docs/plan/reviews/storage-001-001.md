# Review: storage-001

## Findings

- **P1 · resolved before review completion** — The new settings API accepts model-profile updates without authentication, and the original production listener bound all network interfaces. A reachable client could change the main profile's `baseUrl` while submitting an empty API key (which preserves the saved key), causing a later model request to send that key to the client's endpoint. The production entrypoint now uses `listenWebApp()` with `127.0.0.1`; `verify:storage` checks the bound address, and the README and module design document the local-only boundary.
- **P2 · non-blocking, added to backlog** — `resolveDataPath()` rejects lexical `../` escapes, but does not resolve symlink targets. A relative path such as `library/linked/source.pdf` is accepted when `linked` points outside the data root; I reproduced the helper returning a path whose `realpath()` is outside the root. This requires a symlink in local library data, so it is follow-up containment hardening for the single-user local installation. The item is recorded in `docs/plan/backlog.md`.

## Verification

- `npm run typecheck` passed.
- `npm run verify:storage` passed. It covers schema initialization, idempotent legacy `metadata.json` import, source/JSON/Markdown archive creation, relative-path-backed DB records, settings API secret non-echo, empty-key preservation, explicit key clearing, and rejection of a text-only vision model. It also asserts that the production listener address is `127.0.0.1`.
- `npm run verify:agent` passed. The scripted request uses a text-only main model, verifies its stream receives the main profile key, verifies the separate vision call receives one rendered image and the vision profile key, and checks the exact whitespace-preserving transcript in the page block and persisted JSON/Markdown artifacts.
- `npm run verify:web-read` passed after its listeners were updated to await readiness. `npm run verify:agent-parallel`, `npm run verify:pdf-page-render`, and `npm run verify:document-search` passed; `npm run build` and `git diff --check` passed.
- Source review confirmed the `documents`, `model_configs`, and `app_settings` schema; schema version 1 is rejected when newer than the running application. Legacy paths are derived from each library directory rather than trusted from metadata. Database paths are stored relative to the data root. Both model profiles are resolved before agent creation; the main model is not required to support images, while the vision profile is. Main streaming and Pi AI `completeSimple()` vision requests receive their own saved API key and optional model endpoint. The scan tool persists the vision response text directly, without handing it to the main model for re-transcription.
- No live provider call was made; model calls are covered with injected Pi model seams so no API key is needed for this verification.

## Conclusion

**pass** — SQLite indexing, legacy import, file artifacts, settings behavior, and the independent main/vision request paths meet the `storage-001` contract. The unauthenticated settings exposure is contained by the documented loopback-only listener. The remaining symlink-target escape is a non-blocking local-data hardening item in the backlog.
