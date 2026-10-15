# Web PDF Reading Surface

Status: Implementation contract

## Design Principles

- Preserve CrossDoc's warm paper, grid, dark header, and blue action style.
- Keep the start state quiet: one large file area, selected file tree, and a Library entry. Do not show document contents from the Library on the start page.
- Reading is the primary path. Consistency review remains a separate optional action.
- Keep each selected PDF visible in the reading state with its own progress and outcome.
- Every answer citation is a real page link to the archived source PDF.

## Overall Structure

The page has three states: selection, reading, and Library. Starting a read replaces the selection view with the reading view. The Library remains reachable from the header. Returning to selection is explicit; it does not discard files already archived.

## Page-Level Layout

```text
Selection
┌───────────────────────────────────────────────────────┐
│ CrossDoc                                      ▤ 资料库 │
├───────────────────────────────────────────────────────┤
│                                                       │
│                 拖放文件或文件夹                       │
│              [选择文件] [选择文件夹]                   │
│                                                       │
│ 待读取目录树 / 文本列表                    [开始读取]  │
└───────────────────────────────────────────────────────┘

Reading
┌───────────────────────────────────────────────────────┐
│ CrossDoc    当前阅读                         ▤ 资料库 │
├────────────────────────┬──────────────────────────────┤
│ 已选文件                │ 概述                         │
│ ● 合同.pdf  已完成       │ Agent 的简短概述及页码引用    │
│ ◌ 扫描件.pdf 识别第 2 页 │                              │
│ ! 损坏.pdf 读取失败      │ ─────────────────────────── │
│                         │ 问题与回答                    │
│ [返回选择文件]           │ 问题输入…             [发送] │
└────────────────────────┴──────────────────────────────┘

Library
┌───────────────────────────────────────────────────────┐
│ 资料库                                  返回开始读取   │
├───────────────────────────────────────────────────────┤
│ 已归档源文件和 Markdown 的列表                         │
└───────────────────────────────────────────────────────┘
```

The reading file list is ordered by the original browser selection. It shows file name and one compact state: waiting, reading, ready, or failed. The right side shows the overview first and appends Q&A turns below it. Page citations use an inline linked marker such as `[第 3 页]`.

## API Contract

All endpoints are local to the Web server. The session map is in memory; the durable user artifact remains in `data/library/<document-id>/`.

| Request | Response | Behavior |
|---|---|---|
| `POST /api/read` multipart `documents[]` | `202 { sessionId, documents[] }` | Validates and stores selected PDFs under `.crossdoc/uploads/`, creates a scoped Pi Agent, and starts the first read prompt. Model/provider configuration errors return a setup message before the response is accepted. |
| `GET /api/read/:sessionId/events` | Server-Sent Events | Replays events after `Last-Event-ID`, then streams progress, per-document results, overview/answers, errors, and completion. If the requested cursor predates retained events, it emits a replay notice and a current document/overview/recent-answer snapshot. |
| `POST /api/read/:sessionId/questions` JSON `{ question }` | `202 { accepted: true }` | Starts one follow-up prompt on the same agent and parsed-document scope. Rejects empty input, an unknown or cancelled session, a concurrent question while the agent is busy, or a session that reached 30 accepted questions. |
| `POST /api/read/:sessionId/cancel` | `{ cancelled: true }` | Aborts active model/tool work. Cancelling a follow-up emits a question error, cancelled answer progress, and a terminal `done` event with `operation: "question"`; the UI unlocks and disables the cancelled session. |

The selected PDFs receive opaque UUID document IDs on the server. No model argument accepts a path. Agent tool events are translated into progress phases: `inspect_document` → detection, `parse_document` → extraction, `render_scan_page` / `save_scan_page_text` → scan reading, and `load_document_skill(document-overview)` / final assistant response → overview or answer. A document is ready only after parsing completed and its source/Markdown persistence callback succeeded; selected files skipped by the Agent remain failed and have no archive links.

Event records use monotonically increasing IDs and JSON data. The event types are `progress`, `document`, `overview`, `answer`, `error`, and `done`. A progress payload includes `phase`, `state`, and optional `documentId`, `title`, or `page`. A document payload includes stable ID, display title, state, page count when known, and source/Markdown URLs.

The session's `ParsedDocument` objects and Pi transcript live only for the Web server process. Following questions use `search_document` over full parsed blocks and return to the same Pi conversation. The Web process retains at most six sessions; idle sessions expire after 60 minutes, and all sessions expire after four hours. At capacity, the least recently active idle session is evicted; if every slot is busy, a new read receives HTTP 503. Each session accepts at most 30 questions, retains the latest 500 SSE events subject to a 256 KiB per-session and 4 MiB process-wide event-byte budget, and keeps the latest 10 answer snapshots. Assistant text retained for display or replay is capped at 12,000 characters. If an SSE reconnect asks for events older than the retained window, the server sends the current file states, overview, recent answers, and latest completion state as a snapshot. Restarting the local server ends active sessions; archived source PDFs and Markdown remain in the Library.

### Resource Limits

Web resource limits apply across the whole local server process, not independently per Agent:

- At most 6 retained reading sessions; idle sessions expire after 60 minutes and every session expires after four hours.
- At most 12 selected PDFs, 25 MiB per PDF, and 100 MiB total uploaded source bytes per reading session.
- At most 3 simultaneous PDF parse-plus-archive operations across all Web sessions. One session may use the full process-wide parse allowance.
- At most 1,000,000 extracted text characters per document and 2,000,000 across one reading session. A document exceeding either bound is reported as a per-file error and is not archived; other selected files continue.
- At most 30 follow-up questions per session, 12,000 assistant display characters per answer, 10 retained answer snapshots, and 4 MiB of retained SSE event payloads across the process (256 KiB per session).

Reject a request or affected file with an actionable message when it exceeds a limit. These limits bound concurrent parser work and in-memory agent context while keeping original artifacts on disk.

## Citation Contract

The agent marks sources using `[[cite:<document-id>:<page-number>]]`. The client validates the UUID and positive page number, renders a compact `[第 N 页]` link, and points it to `/api/library/<document-id>/source#page=N`. The link opens the archived source in a new tab, where the browser PDF viewer navigates to that page. Never render model-provided HTML. Invalid citation tokens stay as escaped plain text.

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Drop PDF files/folder | Selection | Adds supported PDFs and displays the resulting directory tree/list. |
| `选择文件` / `选择文件夹` | Selection | Opens the corresponding native file picker. |
| `开始读取` | Selection | Validates non-empty selection, creates one server session, and changes to Reading after acceptance. |
| `Enter` | Question input | Submits the question; `Shift+Enter` inserts a newline. |
| `发送` | Question input | Submits one question and disables input until its answer/error arrives. |
| Citation link | Overview or answer | Opens the archived PDF at the cited page in a new tab. |
| `取消读取` | Active read | Cancels the active Pi Agent run and preserves already archived documents. |
| `返回选择文件` | Reading | Leaves the session view and returns to file selection; the Library remains unchanged. |
| `资料库` | Header | Opens the existing Library list. |

## State Variants

- **Empty selection:** large drop area and file/folder buttons; no explanatory copy beyond a short supported-format hint.
- **Selected:** render a nested directory tree using `webkitRelativePath`; display unsupported files disabled with a short reason. Starting is disabled if there is no PDF.
- **Busy:** show live per-file progress, keep the event stream attached, disable duplicate start and question submission while their operation is active, and provide cancel.
- **Partial success:** show failed files inline and keep successful documents, overview, citations, and Q&A active.
- **No readable text:** show a visible page/file warning and allow questions over any other successful content.
- **Model setup error:** show the actionable Pi model/provider configuration message and return to selection.
- **Network/session error:** show a retry action where safe. Do not create a duplicate read session on an SSE reconnect; reconnect to the same session event stream.
- **Completed:** show the concise overview, follow-up question composer, and per-file final state.
- **Library loading/empty/error:** retain the current Library screen's loading, empty, and error states.
- **Constrained:** below 820px, stack file list above overview and questions; preserve readable full-width citation controls.

## Responsive / Size Constraints

At desktop widths, keep the source list at approximately 300px and let the reading panel consume remaining space. At narrow widths, stack the source list above the conversation. Keep overview/question content at a comfortable line length and allow long file names and answers to wrap.

## Component Tree

```text
App
├── Header
│   ├── Brand
│   └── LibraryEntry
├── SelectionView
│   ├── FilePicker
│   ├── FolderPicker
│   ├── DropArea
│   ├── SelectedFileTree
│   └── StartReadingAction
├── ReadingView
│   ├── ReadProgressList
│   └── Conversation
│       ├── Overview
│       ├── AnswerTurns
│       └── QuestionComposer
└── LibraryView
```

## Page Entry Points

- Selection and Reading share `/` and switch state client-side.
- Library opens through the existing header entry and `/api/library`.
- Source citations use `/api/library/:id/source#page=:page`.
- Agent session operations use `/api/read` and `/api/read/:sessionId/*`.
