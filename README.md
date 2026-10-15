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

每个解析出的文字块都会保留来源 ID 和位置。当前 PDF 解析会保存页码及 PDF 坐标；图片扫描页会明确标记“需要 OCR”，不会悄悄当作空白文本处理。点击 Web UI 中的引用会打开对应 PDF 页并高亮来源文字块。

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

命令行会在 `crossdoc-output/` 保存 `review.json`、`review.md`，并在 `documents/` 下保存每份文档的结构化 JSON 和带来源脚注的 Markdown。

构建：

```bash
npm run build
```

构建后的 CLI 入口：

```bash
node dist/cli.js review "./examples/docs/*.pdf"
```

启动最简 Web UI：

```bash
npm run dev:web
```

然后打开：

```text
http://localhost:5177
```

Web UI 只是一层本地可视化入口：上传 PDF、触发同一套审查管线、查看 findings 和 Markdown 报告，并点击引用打开对应原 PDF 页。上传文件保存在 `.crossdoc/uploads/`，审查 JSON 和 Markdown 保存在 `.crossdoc/reviews/`。

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
│   │   ├── pdf.ts
│   │   └── types.ts
│   ├── markdown/
│   │   ├── document.ts
│   │   └── review-report.ts
│   ├── storage/
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

- `loaders/` 按文件格式读取内容并转换成 `core/` 定义的统一结构；目前接入 PDF。
- PDF 内容块记录页码、文字和坐标，抽取的 claim 会指回这些来源块。
- `markdown/` 分别生成单文档转换 Markdown 和最终审查报告。
- `storage/` 在展示报告前保存 JSON 和 Markdown。
- 图片扫描件的 OCR、Word 和 Excel 解析器还未接入。
- Claim 抽取是确定性的，并且刻意保守。
- 比较与验证目前是基于规则的占位实现。
- Pi 接入仍隔离在 `src/agent.ts`，格式解析和报告生成不依赖 Pi。

下一步：用相同的 loader 契约加入 DOCX、XLSX 和扫描件 OCR，并扩展 Web 预览以高亮 PDF 坐标区域。

## 致谢

CrossDoc 构建在 Pi 的最小 agent harness 与扩展哲学之上。向 Pi 项目和维护者致敬：

- Pi 官方源码：https://github.com/earendil-works/pi
