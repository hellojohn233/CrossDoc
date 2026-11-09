# Web PDF Reading Surface

Status: Implementation contract

## Design Principles

- Preserve CrossDoc's warm paper, grid, dark header, and blue action style.
- Keep the start state quiet: one large file area, selected file tree, and header navigation. Do not show document contents from the Library on the start page.
- Reading is the primary path. Consistency review remains a separate optional action.
- Keep each selected PDF visible in the reading state with its own progress and outcome.
- Every answer citation is a real page link to the archived source PDF.

## Overall Structure

The page has four states: selection, reading, the Library, and the review console. Model configuration and the user's own skills are two more peer views reachable from the header; neither gates entry, so the app always opens on selection. If the main model is incomplete, selection shows a non-blocking notice that links to the configuration view. Starting a read replaces the selection view with the reading view. The Library, the configuration view, and the skills view stay reachable from the header at any time. Returning to selection is explicit; it does not discard files already archived.

The header is a text navigation, not a row of buttons. The brand sits on the left, the tabs follow as plain words, and the current tab is marked by ink type and a two-pixel rule on the header's bottom edge. A hairline separates the workflow tabs (upload, Library, review history) from the setup tabs (model configuration, user's skills), because the two groups are not the same kind of thing.

## Page-Level Layout

```text
Selection
┌───────────────────────────────────────────────────────┐
│ CrossDoc   [上传][文档][审查记录][模型配置]              │
├───────────────────────────────────────────────────────┤
│                                                       │
│                 拖放文件或文件夹                       │
│              [选择文件] [选择文件夹]                   │
│                                                       │
│ 待读取目录树 / 文本列表                    [开始读取]  │
└───────────────────────────────────────────────────────┘

Reading
┌───────────────────────────────────────────────────────┐
│ CrossDoc   [上传][文档][审查记录]   当前阅读  [返回]   │
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
│ CrossDoc  [上传][文档][审查记录][模型配置][我的技能]      │
├───────────────────────────────────────────────────────┤
│ 文档                                                   │
│ 读过的文档都在这里。勾选两份以上就能直接发起审查。      │
├───────────────────────────────────────────────────────┤
│ 3 组内容相同，共 30 份归档。展开可以看到每一次归档。    │
├───────────────────────────────────────────────────────┤
│ ☑ 合同a.pdf   PDF · 1 页 · 2026/10/27   打开源文件↗ …  │
│                  另有 9 份相同内容 ▾                   │
│   （收起时副本不可见）                                 │
├───────────────────────────────────────────────────────┤
│ ☐ 合同b.pdf   PDF · 1 页 · 2026/10/27   打开源文件↗ …  │
├───────────────────────────────────────────────────────┤
│ 已选 2 份文档                    [用选中文件审查]      │
└───────────────────────────────────────────────────────┘

Review history
┌───────────────────────────────────────────────────────┐
│ CrossDoc  [上传][文档][审查记录][模型配置][我的技能]      │
├───────────────────────────────────────────────────────┤
│ 审查记录                                               │
│ 跑过的审查与报告。点「打开」回到当时的冲突清单。         │
│ 共 20 次审查。                                         │
├───────────────────────────────────────────────────────┤
│ 合同a.pdf、合同b.pdf                       [打开]      │
│ 3 份文档 · 12 条关键数据 · 4/4 条冲突已确认 · 2026/11/5│
└───────────────────────────────────────────────────────┘

My skills
┌───────────────────────────────────────────────────────┐
│ CrossDoc  [上传][文档][审查记录][模型配置][我的技能]      │
├───────────────────────────────────────────────────────┤
│ 我的技能                                  [新建][导入]  │
│ 只补充「这个领域抽什么、什么差异算严重」，审查流程不变。 │
│ 共 1 份领域 skill。内置的流程 skill 不在这里…          │
├───────────────────────────────────────────────────────┤
│ ┌──┐  prospectus-review                     [编辑]    │
│ │ P │  用于审查证券招股说明书。当这批文档是招股书…      │
│ └──┘  更新于 2026-11-08 00:46                         │
└───────────────────────────────────────────────────────┘

My skills, editor
┌───────────────────────────────────────────────────────┐
│ CrossDoc  [上传][文档][审查记录][模型配置][我的技能]      │
├───────────────────────────────────────────────────────┤
│ [← 返回列表]                                        │
│ 编辑 prospectus-review                               │
├───────────────────────────────────────────────────────┤
│ 名称  [prospectus-review                            ]  │
│ 描述  [用于审查证券招股说明书…                       ]  │
│ 正文  [本领域该抽哪些关键数据…                      ]  │
│ [保存]  [删除]                                        │
└───────────────────────────────────────────────────────┘
```

The skill list is not a table. One skill is one row, and the row carries its own hierarchy: the name is the heading, the description is the second line, and the last change is a quiet note under it. Nothing is sorted into equal-weight columns, because a skill is not a record — it is a document with a name and a body.

The reading file list is ordered by the original browser selection. It shows file name and one compact state: waiting, reading, ready, or failed. A file whose content is already in the Library also says so: *这份内容已在文档列表里（title，date），会作为一份新的归档保存。* The right side shows the overview first and appends Q&A turns below it. Page citations use an inline linked marker such as `[第 3 页]`.

The Library holds the archived documents. Each row carries a checkbox that picks the document for a review. A review that is picked up in the Library does not need to be uploaded again — the archived source file is what the review reads.

The review history has a page of its own, under `审查记录`. The Library keeps the inputs; the history keeps the results, and a review result is this product's main output, so it does not sit under the document list. Each row carries the document titles, the counts, and the time, and `打开` loads the stored body into the console.

The document list is grouped by content. A document's identity is its content, and every upload is still archived, so the same contract uploaded three times is one row with two copies underneath it. The oldest copy in a group is the primary row and carries the checkbox; the copies carry none, because they are the same content and picking one would mean picking the others. The copies are collapsed behind a control that reads `另有 N 份相同内容 ▾` and toggles to `收起相同内容 ▴`. A notice above the list reports how many groups repeat and how many archives that is in total. The row metadata shows the first-archived date, and the last-used date as well when it differs — reviewing a document does not make it newly archived.

The row is a document, not a record, so it reads like one: the file name is the heading, the details are the line under it, and the two links to the source file and to the converted Markdown are quiet text on the right. The name and the details carry the weight; the links do not.

## API Contract

All endpoints are local to the Web server. The session map is in memory; the durable user artifact remains in `data/library/<document-id>/`.

| Request | Response | Behavior |
|---|---|---|
| `POST /api/read` multipart `documents[]` | `202 { sessionId, documents[] }` | Validates and stores selected PDFs under `.crossdoc/uploads/`, creates a scoped Pi Agent, and starts the first read prompt. Model/provider configuration errors return a setup message before the response is accepted. A file whose content is already in the Library carries `duplicateOf` — the archived document's id, title, and first-archived date — so the reading list can say the content is already there while still archiving it again. Two identical files in one selection count as one document; the second stays visible in the session as a per-file failure. |
| `GET /api/read/:sessionId/events` | Server-Sent Events | Replays events after `Last-Event-ID`, then streams progress, per-document results, overview/answers, errors, and completion. If the requested cursor predates retained events, it emits a replay notice and a current document/overview/recent-answer snapshot. |
| `POST /api/read/:sessionId/questions` JSON `{ question }` | `202 { accepted: true }` | Starts one follow-up prompt on the same agent and parsed-document scope. Rejects empty input, an unknown or cancelled session, a concurrent question while the agent is busy, or a session that reached 30 accepted questions. |
| `POST /api/read/:sessionId/cancel` | `{ cancelled: true }` | Aborts active model/tool work. Cancelling a follow-up emits a question error, cancelled answer progress, and a terminal `done` event with `operation: "question"`; the UI unlocks and disables the cancelled session. |

The review desk adds three endpoints of its own. They are listed here because the Library is where they are used.

| Request | Response | Behavior |
|---|---|---|
| `POST /api/review/from-library` JSON `{ documentIds }` | NDJSON stream | Starts one consistency review over documents that are already archived. Resolves each id against the library and reads the archived source file, so nothing is uploaded again. Rejects an empty selection with 400 and an unknown document id with 404. The stream is the same one `POST /api/review` produces. |
| `GET /api/reviews` | `{ reviews: [...] }` | Lists the stored reviews, newest first. Each entry carries the id, the creation time, the document titles, the document count, the claim count, the conflict count, and the verified conflict count. |
| `GET /api/reviews/:id` | review body | Returns one stored review in exactly the shape the live stream ends with, so the console renders a reopened review the same way it renders a fresh one. An unknown or malformed id returns 404. |

The user's own skills have four endpoints of their own. They are listed here because the skills view is where they are used.

| Request | Response | Behavior |
|---|---|---|
| `GET /api/skills` | `{ skills: [{ name, description, body, updatedAt }] }` | Lists the user's own skills, flat, newest first. The built-in skills are not returned: they are read-only and live in the repository. |
| `PUT /api/skills/:name` | `{ skill, warnings }` | Writes one skill. The body is `{ description, body }`. The front-matter is generated by the server. An invalid name or an empty description or body is a 400; a name that a built-in skill already uses is a 409. |
| `DELETE /api/skills/:name` | `{ deleted: true }` | Removes one skill and its directory. An unknown name is a 404. |
| `POST /api/skills/import` | `{ skill: { name, description, body } }` | Parses a `SKILL.md` the user brought along and returns it for the editor. It does not write: an imported skill changes what the next review does, so the user sees it first and saves it on purpose. A file without usable front-matter is a 400. |

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
| `上传` / `文档` / `审查记录` / `模型配置` / `我的技能` | Header tabs | Switches between the selection, Library, review history, model configuration, and skills views; the active tab carries `aria-current="page"`. |
| `返回阅读` | Review console | Returns to the reading view of the active session and re-attaches the event stream. |
| Document checkbox | Library | Picks an archived document for a review. The selection bar reports the count and enables the review action from two documents up. Only the primary row of a content group carries a checkbox; the copies are the same content. |
| `另有 N 份相同内容` | Library | Expands or collapses the copies archived under a document. The control's label and `aria-expanded` follow the state. |
| `用选中文件审查` | Library | Starts a review over the picked documents and switches to the review console. The documents are read from the library, not uploaded. |
| `打开` on a review record | Review history | Loads a stored review into the review console. The `审查记录` tab stays marked as the current one, and `返回阅读` is hidden because the console does not belong to the running read. |
| `新建` | My skills | Clears the editor so a new skill can be written. |
| `导入 .md` | My skills | Reads a `SKILL.md` the user brought along and fills the editor with it. It does not save it. |
| `保存` | My skills | Writes the skill. The message says it takes effect on the next review. |
| `删除` | My skills | Removes the skill after a confirmation. |

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
- **Library with repeated content:** one row per document, the copies collapsed behind a control, and a notice naming how many groups repeat. The list says how many documents there are, not how many times they arrived.
- **Constrained:** below 820px, stack file list above overview and questions; preserve readable full-width citation controls.

## Responsive / Size Constraints

At desktop widths, keep the source list at approximately 300px and let the reading panel consume remaining space. At narrow widths, stack the source list above the conversation. Keep overview/question content at a comfortable line length and allow long file names and answers to wrap.

## Component Tree

```text
App
├── Header
│   ├── Brand
│   └── TopNav (上传 / 文档 / 审查记录 / 模型配置 / 我的技能)
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
├── LibraryView
│   ├── LibraryContentGroups
│   │   ├── LibraryDocumentList
│   │   │   └── LibraryReviewPicker
│   │   └── LibraryCopyList (collapsed)
│   ├── LibrarySelectionBar
│   └── ReviewHistoryList
├── ModelSetupView
├── SkillsView
│   ├── UserSkillList
│   └── UserSkillEditor
└── ReviewConsole
    ├── ConflictLedger
    └── DocumentComparison
```

## Page Entry Points

- Selection and Reading share `/` and switch state client-side.
- The document list opens through the `文档` header tab and `/api/library`.
- The review history opens through the `审查记录` header tab and `/api/reviews`.
- Model configuration opens through the `模型配置` header tab.
- The user's own skills open through the `我的技能` header tab and use `/api/skills`.
- Source citations use `/api/library/:id/source#page=:page`.
- Agent session operations use `/api/read` and `/api/read/:sessionId/*`.
- Review history uses `/api/reviews` and `/api/reviews/:id`; a review over archived documents uses `/api/review/from-library`.
