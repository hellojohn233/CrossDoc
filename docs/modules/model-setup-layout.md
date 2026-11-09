# Settings Layout

Status: Implementation contract

## Design Principles

- Match CrossDoc's warm paper, grid, dark header, taupe outlines, and blue action style.
- Do not show a provider selector or a preselected provider/model.
- Keep the main and scanned-page vision configurations separate.
- Do not render saved API keys back into the page.
- Configuration is a peer view, not a gate: the app always opens on document selection.
- The header tab is the only configuration entry point; the selection view carries no extra notice.

## Overall Structure

The model configuration page is a top-level view reachable from the header navigation. It is never a startup gate. Each configured model role stores a custom Base URL, a Pi protocol, a selected model ID, and an API key in SQLite. Existing v1 catalog profiles remain usable: they count as configured when their provider/model are present and either a key is stored or Pi has an ambient credential for that provider. The protocol choices are:

| UI option | Pi API identifier | Model-list endpoint |
|---|---|---|
| OpenAI 兼容 | `openai-completions` | `GET {baseUrl}/models`, Bearer API key |
| Anthropic Messages | `anthropic-messages` | `GET {baseUrl}/models`, `x-api-key` and `anthropic-version` headers |
| Google Gemini API | `google-generative-ai` | `GET {baseUrl}/models`, API key authentication |

For standard bases, OpenAI and Anthropic Base URLs include `/v1`; Gemini uses `/v1beta`. Custom compatible endpoints may use their own base path. Server-side model discovery has a 10-second request timeout and reads at most 1 MiB. It never saves the discovery key. If a model-list request fails or returns no usable IDs, the model field remains editable for manual entry. For a custom vision profile, select a model ID that supports image input; a generic model-list response may not expose that capability.

## Page-Level Layout

```text
Any entry state
┌───────────────────────────────────────────────────────────────┐
│ CD  CrossDoc    [上传][文档][审查记录][设置]                   │
├───────────────────────────────────────────────────────────────┤
│                     设置                                     │
│      配置不阻塞浏览，但开始读取前需要主模型可用                 │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 主模型                                      ● 已配置    │  │
│  │ 概述、追问和审查编排都走它。开始读取前必须配好。         │  │
│  │ ─────────────────────────────────────────────────────── │  │
│  │ Base URL     [https://api.example.com/v1              ] │  │
│  │ 模型协议     [OpenAI 兼容 ▾]                           │  │
│  │ 模型 ID      [MiniMax-M3.1-Flash]  [加载模型]          │  │
│  │ API Key      [••••••••••]  ☐ 清除已保存的 Key           │  │
│  │ ─────────────────────────────────────────────────────── │  │
│  │ [测试连接]                              [保存主模型]    │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 扫描页视觉模型 (可选)                      ● 已配置    │  │
│  │ 只用来读扫描页图片。不配，扫描页就读不出来。             │  │
│  │ ─────────────────────────────────────────────────────── │  │
│  │ …                                                  │  │
│  │ [测试连接]                              [保存视觉模型]  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  API Key 以明文保存在本机 data/crossdoc.sqlite，不随文档上传    │
└───────────────────────────────────────────────────────────────┘

```

The two roles are stacked, not side by side. A role is a block of settings, not a column in a comparison, so each one gets the full width and carries its own hierarchy: the role name is the heading, a line under it says what the role is for, and a status badge on the right says whether it is configured. The fields are a label on the left and the control on the right, so the four values line up and can be scanned. The status badge is a quiet pill with a dot, not a line of text under the last field.

The main model comes first and is what the page is for. The vision model is marked `可选`, because a review without a vision profile still works on text pages. The page width is capped so the settings read as a form rather than a stretched table.

The selection view stays free of any model notice; the `设置` tab is the only way in. The settings view is titled `设置`: it holds the models and the archive storage.

## Connection Test

`POST /api/settings/models/test` answers one question: would a request to this endpoint work? It is a diagnostic, not a save.

| Request | Response | Behavior |
|---|---|---|
| `POST /api/settings/models/test` JSON `{ role, protocol, baseUrl, modelId, apiKey? }` | `{ ok: true, modelId, latencyMs, reply }` or `{ ok: false, error }` | Resolves the profile the same way a real request would, then sends one short prompt and reports the round trip. An omitted `apiKey` falls back to the stored key for that role, so a saved configuration can be tested without typing the key again. |

Two rules keep the test honest:

- **It never writes.** The test resolves the model against a throwaway catalog, not the shared one, so a test's Base URL or key cannot overwrite a saved profile.
- **It checks reachability, not capability.** The prompt asks for a single word, so the answer proves the endpoint, the protocol, the model id, and the key all line up. It does not prove image input works; the vision panel says so in the result's tooltip instead of implying more than was checked.

A missing role, an unsupported protocol, a missing model id, or an invalid Base URL is rejected with 400 and an actionable message, before any network call is made.

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Base URL, protocol, API Key | One role | Supplies credentials and API shape for model discovery and inference. |
| `加载模型` | One role | Calls `POST /api/settings/models/discover`; displays model IDs returned for that connection. Does not save the profile or key. |
| Model name field | One role | Selects a discovered ID or accepts a manually entered ID if discovery is unavailable. |
| `测试连接` | One role | Calls `POST /api/settings/models/test` with the values currently in the form and reports whether the endpoint answered. Does not save the profile or key. |
| `保存主模型` / `保存视觉模型` | One role | Saves that role's Base URL, protocol, model ID, and key to SQLite. The other role remains independent. |
| `设置` header tab | Global | Switches to the settings view from any other view; the active tab carries `aria-current="page"`. |
| Reload / direct visit | App entry | Fetches settings, then always opens document selection. Saved profiles only decide the per-role status shown inside the configuration view. |

## State Variants

- **Booting:** hide every view until `GET /api/settings` resolves.
- **Incomplete main model:** the configuration view shows the missing status on that role; every other view stays usable, and only starting a read fails.
- **Incomplete vision model:** the configuration view shows the missing status on that role; only scanned pages are affected at read time.
- **Model discovery busy:** disable that panel's load action and show progress; the other panel remains usable.
- **Model discovery empty/error:** show a concise error and preserve manual model ID entry.
- **Connection test busy:** disable that panel's test action and show `正在测试…`; the other panel remains usable.
- **Connection test ok:** show the round-trip time and the model's reply next to the button.
- **Connection test failed:** show the actionable error next to the button and keep the entered values.
- **Saving:** disable the active panel's save action while the server persists settings.
- **Save error:** retain entered values and show the actionable error.
- **Complete:** hide the incomplete-main-model notice; later visits skip it as well.
- **Settings load error:** show retry instead of exposing document selection.
- **Constrained:** stack role panels at narrow widths, preserve full-width inputs, and allow vertical scrolling.

## Component Tree

```text
AppEntry
├── StartupState (while GET /api/settings resolves)
└── Workspace
    ├── TopNav (上传 / 文档 / 审查记录 / 设置 / 我的技能)
    ├── SelectionView
    ├── ReadingView
    ├── LibraryView
    ├── ReviewConsole
    └── SettingsView
        ├── ModelBlock
        │   ├── MainModelPanel
        │   └── VisionModelPanel
        └── ArchiveBlock
            ├── ArchiveGroupList
            └── ClearArchiveButton
```

## Page Entry Points

- `/` always opens document selection; configuration never intercepts entry.
- The header `设置` tab is the only entry point for the settings view.
- Successful setup saves settings to SQLite and refreshes the role status without a reload.

## Archive Storage

The settings view has a second block, `归档存储`, below the models. Every read archives a document, and the archive keeps every upload, so the archive grows with use. The block exists because the archive is the one part of the product the user cannot empty by any other means.

The block lists every archive, not the folded document list: archives that share content sit in one group under the document's name, and each archive is a row of its own with the moment it arrived and the first twelve characters of its content hash. Each row has a `删除` action; the block has a `清空归档` action. Both ask for a confirmation first, because a removed archive is gone: its source file and its Markdown go with the index row.

An archive and its index row are removed together. A row without files would offer a document that cannot be opened, and files without a row would sit on disk with nothing left to find them.
