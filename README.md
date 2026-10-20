# CrossDoc

[中文](./README.md) | [English](./README.en.md)

CrossDoc — 一个基于证据的文档一致性审查 Agent，构建在 Pi 之上。

CrossDoc 不是一个 Pi demo。Pi 是最小化的 Agent 运行时；CrossDoc 是围绕多文档一致性审查构建的领域系统：解析、抽取、比较、验证，并用证据报告文档之间的矛盾。

## 核心思想

1. **文档一致性审查**：发现矛盾、保留证据，让结果可溯源、可评测。
2. **Pi Agent 运行时**：使用 `@earendil-works/pi-agent-core` 承载 agent loop，用 `@earendil-works/pi-ai` 统一模型访问，不自己重复造 agent loop。

设计原则：

> CrossDoc 使用 Pi 作为最小运行时底座，把核心工程能力集中在 Pi 不直接解决的领域问题上：多文档一致性审查的误报控制、证据追踪和结果可评测性。

## 为什么这样设计

Pi 是发动机，审查是整车。

审查流水线由 CrossDoc 自己负责：

- `parse_doc`：由格式解析器读取文档，产出带来源位置的统一 JSON。
- `extract_claims`：把文档文本转换成可审查的 claims。
- `compare_claims`：跨文档查找候选矛盾。
- `verify_conflicts`：降级弱匹配，控制误报。
- `report_conflicts`：从结构化审查结果生成带来源引用的 Markdown 报告。

每个解析出的文字块都会保留来源 ID 和位置。PDF 按页区分可提取文字和扫描内容：文字层保留 PDF 坐标，扫描页由 Pi 视觉模型读取并保留页码来源。点击引用会打开对应 PDF 页；首版扫描文字只保证页级定位。

Pi 只作为运行时边界使用：

- agent loop
- 模型 provider 抽象
- 工具注册与执行

## 快速开始

安装依赖：

```bash
npm install
```

运行一个不依赖 LLM 的确定性本地审查：

```bash
npm run dev -- review "./examples/docs/*.pdf"
```

命令行会在 `crossdoc-output/` 保存 `review.json`、`review.md`,并在 `documents/` 下保存每份文档的结构化 JSON 和带来源脚注的 Markdown。

`examples/docs/` 里是三份可重建的示例合同(两份修订版 + 一份含相同样板条款的合同),用来演示文档转换和一致性审查。重新生成:

```bash
npm run examples:generate
```

构建：

```bash
npm run build
```

构建后的 CLI 入口：

```bash
node dist/cli.js review "./examples/docs/*.pdf"
```

首次读取前，在开始页右上角的“设置”中分别配置主模型和扫描页视觉模型。两种模型必须来自 Pi AI 内置目录；视觉模型必须支持图像输入。主模型可以是纯文本模型。API Key、可选的兼容 API 地址和模型选项保存在本机 `data/crossdoc.sqlite`。本项目面向单用户本机使用，Web 服务只绑定到 `127.0.0.1`，API Key 以明文保存在该 SQLite 文件中。

```bash
npm run dev:web
```

然后打开：

```text
http://localhost:5177
```

Web UI 的主要入口用于阅读：选择 PDF 后由 Pi Agent 按文件格式调用解析工具，扫描页通过视觉模型读取，接着生成简短概述并支持基于同一会话追问。阅读进度通过可重放的 SSE 事件发送，引用可以打开归档 PDF 的对应页。确定性一致性审查仍由独立的 `/api/review` 路由提供。

上传源文件暂存于 `.crossdoc/uploads/`，解析成功后源 PDF、标准化结构化 JSON 和转换 Markdown 归档在本地 `data/library/<资料 ID>/`。SQLite 保存资料索引与两个模型角色的设置，并在启动时幂等导入已有 `metadata.json` 条目。临时上传在读取任务结束后清理。`data/` 已加入 `.gitignore`，不会进入 Git 提交。开始页仅提供资料库入口、设置入口和文件选择，不会预览库内文档。

## Pi 版本纪律

本项目通过 npm 依赖使用 Pi，不 fork Pi 源码。

当前兼容基线：

- `@earendil-works/pi-agent-core`: `^1.2.0`
- `@earendil-works/pi-ai`: `^1.2.0`

`package-lock.json` 会提交到仓库，确保传递依赖变化可审查。

## 项目结构

```text
CrossDoc/
├── package.json
├── src/
│   ├── agent.ts
│   ├── cli.ts
│   ├── core/
│   │   ├── claims.ts
│   │   └── types.ts
│   ├── loaders/
│   │   ├── index.ts
│   │   ├── pdf-line-blocks.ts
│   │   ├── pdf.ts
│   │   └── types.ts
│   ├── markdown/
│   │   ├── document.ts
│   │   └── review-report.ts
│   ├── storage/
│   │   ├── library-store.ts
│   │   └── review-store.ts
│   └── tools/
│       ├── compare.ts
│       ├── extract.ts
│       ├── parse.ts
│       ├── report.ts
│       └── verify.ts
└── examples/
    └── docs/
```

## 当前状态

当前的数据流程：

- `loaders/` 按文件格式读取内容并转换成 `core/` 定义的统一结构;目前接入 PDF。
- PDF 内容块以**行**为单位,记录页码、文字和坐标,抽取的 claim 会指回这些来源块。
- 扫描页的视觉转写同样按行拆块,但保留页级定位,不伪造行坐标。
- `markdown/` 分别生成单文档转换 Markdown 和最终审查报告;来源脚注按来源位置去重,原生行各自一条,扫描页一页一条。
- `storage/` 在展示报告前保存 JSON 和 Markdown。
- PDF 扫描页由配置的 Pi 视觉模型读取;Word 和 Excel 解析器还未接入。
- Claim 抽取是确定性的,并且刻意保守。
- 比较与验证目前是基于规则的占位实现。
- Pi 接入仍隔离在 `src/agent.ts`,格式解析和报告生成不依赖 Pi。

Web 阅读入口、request-scoped Pi Agent、自动概述和引用来源页的后续提问已接通。后续可以在同一 source-location 契约下增加 DOCX、XLSX 与图片加载器。

## 致谢

CrossDoc 构建在 Pi 的最小 agent harness 与扩展哲学之上。向 Pi 项目和维护者致敬：

- Pi 官方源码：https://github.com/earendil-works/pi
