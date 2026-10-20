# Model Setup Layout

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
│ CD  CrossDoc    [上传][资料库][模型配置]                        │
├───────────────────────────────────────────────────────────────┤
│                    模型配置                                   │
│      配置不阻塞浏览，但开始读取前需要主模型可用                 │
│                                                               │
│  ┌────────────────────────┐  ┌────────────────────────────┐  │
│  │ 主模型                 │  │ 扫描页视觉模型             │  │
│  │ Base URL               │  │ Base URL                   │  │
│  │ 模型协议               │  │ 模型协议                   │  │
│  │ 模型 ID [加载模型]     │  │ 模型 ID [加载模型]         │  │
│  │ API Key                │  │ API Key                    │  │
│  │ 尚未配置完整            │  │ 尚未配置完整               │  │
│  │ [保存主模型]           │  │ [保存视觉模型]             │  │
│  └────────────────────────┘  └────────────────────────────┘  │
│                                                               │
│  API Key 以明文保存在本机 data/crossdoc.sqlite，不随文档上传    │
└───────────────────────────────────────────────────────────────┘

```

The selection view stays free of any model notice; the `模型配置` tab is the only way in.

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Base URL, protocol, API Key | One role | Supplies credentials and API shape for model discovery and inference. |
| `加载模型` | One role | Calls `POST /api/settings/models/discover`; displays model IDs returned for that connection. Does not save the profile or key. |
| Model name field | One role | Selects a discovered ID or accepts a manually entered ID if discovery is unavailable. |
| `保存主模型` / `保存视觉模型` | One role | Saves that role's Base URL, protocol, model ID, and key to SQLite. The other role remains independent. |
| `模型配置` header tab | Global | Switches to the configuration view from any other view; the active tab carries `aria-current="page"`. |
| Reload / direct visit | App entry | Fetches settings, then always opens document selection. Saved profiles only decide the per-role status shown inside the configuration view. |

## State Variants

- **Booting:** hide every view until `GET /api/settings` resolves.
- **Incomplete main model:** the configuration view shows the missing status on that role; every other view stays usable, and only starting a read fails.
- **Incomplete vision model:** the configuration view shows the missing status on that role; only scanned pages are affected at read time.
- **Model discovery busy:** disable that panel's load action and show progress; the other panel remains usable.
- **Model discovery empty/error:** show a concise error and preserve manual model ID entry.
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
    ├── TopNav (上传 / 资料库 / 模型配置)
    ├── SelectionView
    ├── ReadingView
    ├── LibraryView
    ├── ReviewConsole
    └── ModelSetupView
        ├── MainModelPanel
        └── VisionModelPanel
```

## Page Entry Points

- `/` always opens document selection; configuration never intercepts entry.
- The header `模型配置` tab is the only entry point for the configuration view.
- Successful setup saves settings to SQLite and refreshes the role status without a reload.
