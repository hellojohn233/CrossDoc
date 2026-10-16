# Model Setup Layout

Status: Implementation contract

## Design Principles

- Match CrossDoc's warm paper, grid, dark header, taupe outlines, and blue action style.
- Do not show a provider selector or a preselected provider/model.
- Keep the main and scanned-page vision configurations separate.
- Do not render saved API keys back into the page.

## Overall Structure

The setup page is the first-run gate. Each model role stores a custom Base URL, a Pi protocol, a selected model ID, and an API key in SQLite. The protocol choices are:

| UI option | Pi API identifier | Model-list endpoint |
|---|---|---|
| OpenAI 兼容 | `openai-completions` | `GET {baseUrl}/models`, Bearer API key |
| Anthropic Messages | `anthropic-messages` | `GET {baseUrl}/models`, `x-api-key` and `anthropic-version` headers |
| Google Gemini API | `google-generative-ai` | `GET {baseUrl}/models`, API key authentication |

For standard bases, OpenAI and Anthropic Base URLs include `/v1`; Gemini uses `/v1beta`. Custom compatible endpoints may use their own base path. Server-side model discovery has a 10-second request timeout and reads at most 1 MiB. It never saves the discovery key. If a model-list request fails or returns no usable IDs, the model field remains editable for manual entry.

## Page-Level Layout

```text
First run: one or both profiles missing
┌───────────────────────────────────────────────────────────────┐
│ CD  CrossDoc                                                  │
├───────────────────────────────────────────────────────────────┤
│                    模型设置                                   │
│                配置后开始读取文档                             │
│                                                               │
│  ┌────────────────────────┐  ┌────────────────────────────┐  │
│  │ 主模型                 │  │ 扫描件视觉模型             │  │
│  │ Base URL               │  │ Base URL                   │  │
│  │ 模型协议类型           │  │ 模型协议类型               │  │
│  │ 模型名称 [加载模型]    │  │ 模型名称 [加载模型]        │  │
│  │ API Key                │  │ API Key                    │  │
│  │ 待配置          [配置] │  │ 待配置              [配置]│  │
│  └────────────────────────┘  └────────────────────────────┘  │
│                                                               │
│                    [进入文档读取 disabled]                     │
└───────────────────────────────────────────────────────────────┘

Returning user: both profiles complete
┌───────────────────────────────────────────────────────────────┐
│ CD  CrossDoc                                      ▤ 资料库    │
├───────────────────────────────────────────────────────────────┤
│                  开始读取文档                                 │
│                [选择文件] [选择文件夹]                         │
└───────────────────────────────────────────────────────────────┘
```

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Base URL, protocol, API Key | One role | Supplies credentials and API shape for model discovery and inference. |
| `加载模型` | One role | Calls `POST /api/settings/models/discover`; displays model IDs returned for that connection. Does not save the profile or key. |
| Model name field | One role | Selects a discovered ID or accepts a manually entered ID if discovery is unavailable. |
| `配置` / save action | One role | Saves that role's Base URL, protocol, model ID, and key to SQLite. The other role remains independent. |
| `进入文档读取` | First-run setup | Enabled only after the server confirms both profiles are complete; changes to selection without reloading. |
| Reload / direct visit | App entry | Fetches settings before showing a page. Two complete profiles skip setup; any missing profile opens setup. |
| Settings entry | Selection | Opens the same two custom profile forms for editing. |

## State Variants

- **Booting:** hide setup and workspace until `GET /api/settings` resolves.
- **Incomplete:** show both role panels, their saved/missing status, and a disabled continue action until both profiles are complete.
- **Model discovery busy:** disable that panel's load action and show progress; the other panel remains usable.
- **Model discovery empty/error:** show a concise error and preserve manual model ID entry.
- **Saving:** disable the active panel's save action while the server persists settings.
- **Save error:** retain entered values and show the actionable error.
- **Complete:** allow entry to selection; later visits skip setup.
- **Settings load error:** show retry instead of exposing document selection.
- **Constrained:** stack role panels at narrow widths, preserve full-width inputs, and allow vertical scrolling.

## Component Tree

```text
AppEntry
├── ModelSetupView (either profile incomplete)
│   ├── BrandHeader
│   ├── MainModelPanel
│   ├── VisionModelPanel
│   └── ContinueToSelection
└── Workspace (both profiles complete)
    ├── SelectionView
    ├── ReadingView
    ├── LibraryView
    └── SettingsDialog
```

## Page Entry Points

- `/` with either incomplete profile opens setup.
- `/` with both complete profiles opens document selection.
- Successful setup saves settings to SQLite and enables in-page navigation to selection.
