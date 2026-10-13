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

- `parse_doc`：把本地 PDF 解析成带页码证据的文本。
- `extract_claims`：把文档文本转换成可审查的 claims。
- `compare_claims`：跨文档查找候选矛盾。
- `verify_conflicts`：降级弱匹配，控制误报。
- `report_conflicts`：输出带证据的可溯源 Markdown 报告。

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

Web UI 只是一层本地可视化入口：上传 PDF、触发同一套审查管线、查看 findings 和 Markdown 报告。审查能力仍然在 `src/review.ts`、`src/tools/` 和 `src/core/` 中，Pi agent runtime 仍然隔离在 `src/agent.ts`。

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

这是第一版开发骨架：

- PDF 解析使用 `unpdf`。
- Claim 抽取是确定性的，并且刻意保守。
- 比较与验证目前是基于规则的占位实现。
- Pi 接入被隔离在 `src/agent.ts`，避免模型和 provider 选择污染审查逻辑。

下一步：在保持 `Claim` 和 `Conflict` 数据契约不变的前提下，把确定性 claim 抽取替换为基于 Pi tools 的 LLM 抽取流程。

## 致谢

CrossDoc 构建在 Pi 的最小 agent harness 与扩展哲学之上。向 Pi 项目和维护者致敬：

- Pi 官方源码：https://github.com/earendil-works/pi
