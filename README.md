# CrossDoc

<p align="center">
  <img src="./public/crossdoc-logo.svg" alt="CrossDoc" width="72" height="62" />
</p>

[中文](./README.md) | [English](./README.en.md)

CrossDoc — 一个基于证据的文档一致性审查 Agent，构建在 Pi 之上。

CrossDoc 不是一个 Pi demo。Pi 是最小化的 Agent 运行时；CrossDoc 是围绕多文档一致性审查构建的领域系统：读取、抽取、比较、验证，并用证据报告文档之间的矛盾。

> 标志含义：两个深墨色块代表两份文档，中间贯穿的蓝条代表跨文档对齐后**一致**的那一行，底部断开的琥珀条代表**冲突**的那一行。矢量源在 [`public/crossdoc-logo.svg`](./public/crossdoc-logo.svg)。

## 核心思想

1. **文档一致性审查**：发现矛盾、保留证据，让结果可溯源、可评测。
2. **Pi Agent 运行时**：使用 `@earendil-works/pi-agent-core` 承载 agent loop，用 `@earendil-works/pi-ai` 统一模型访问，不自己重复造 agent loop。

设计原则：

> CrossDoc 使用 Pi 作为最小运行时底座，把核心工程能力集中在 Pi 不直接解决的领域问题上：多文档一致性审查的误报控制、证据追踪和结果可评测性。

## 为什么这样设计

Pi 是发动机，审查是整车。

审查流程不住在代码里，而是住在 skill 里。`.agents/skills/` 下有三份 skill：

| Skill | 管什么 |
|---|---|
| `consistency-review` | 整个审查：读文档、读扫描页、对齐、判定、出报告 |
| `key-data-alignment` | 每份文档抽哪些关键数据,值和引文怎么写 |
| `conflict-adjudication` | 两个取值什么时候才算真冲突,严重度怎么定,怎么报 |

一个 agent 读 `consistency-review`,它再去读另外两份,然后一步步调工具。**改「什么算冲突」是改一个 Markdown 文件,不是发一次版。**

skill 不是写在代码里的名单,是从 `.agents/skills/` **发现**出来的:加一个目录就多一个 skill,不用改 TypeScript。格式遵循 [Agent Skills 规范](https://agentskills.io/specification),和 Pi CLI 用的是同一套,所以这些目录直接扔进 Pi 也能用。

代码里只留下能力与护栏：

- `parse_document`：由格式解析器读取文档，产出带来源位置的统一 JSON。
- `list_key_vocabulary`：给出固定的 key 词表,两份文档才知道「同一个东西」叫什么。
- `align_key_data`：按 key 把各文档的值排成一队,只把取值不同的组交出去(纯函数)。
- `verify_conflicts`：判定落到冲突上,并检查引文是否真在原文里(纯函数)。
- `report_conflicts`：从已经产出的关键数据和冲突生成带来源引用的 Markdown 报告。

护栏留在代码里,因为它们不是步骤,是底线：引文在原文里找不到,这条结论就被丢掉;模型给的 `confidence` 是 `"92%"` 也能照样归一化;同一个工具反复调用会被挡住,审查不会死循环。

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

运行一次一致性审查（需要先在「模型配置」页配好主模型）：

```bash
npm run dev -- review "./examples/docs/*.pdf"
```

命令行会在 `crossdoc-output/` 保存 `review.json`、`review.md`,并在 `documents/` 下保存每份文档的结构化 JSON 和带来源脚注的 Markdown。审查本身由 agent 读 skill 驱动，需要主模型可用。

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

首次读取前，在顶栏的「模型配置」页分别配置主模型和扫描页视觉模型。配置页不阻塞浏览——不配置也能进站、查看资料库，但开始读取需要主模型可用。两种模型必须来自 Pi AI 内置目录；视觉模型必须支持图像输入。主模型可以是纯文本模型。API Key、可选的兼容 API 地址和模型选项保存在本机 `data/crossdoc.sqlite`。本项目面向单用户本机使用，Web 服务只绑定到 `127.0.0.1`，API Key 以明文保存在该 SQLite 文件中。

```bash
npm run dev:web
```

然后打开：

```text
http://localhost:5177
```

Web UI 的主要入口用于阅读：选择 PDF 后由 Pi Agent 按文件格式调用解析工具，扫描页通过视觉模型读取，接着生成简短概述并支持基于同一会话追问。阅读进度通过可重放的 SSE 事件发送，引用可以打开归档 PDF 的对应页。确定性一致性审查仍由独立的 `/api/review` 路由提供。

顶栏是唯一的导航入口，三个页签分别是「上传」「资料库」「模型配置」；当前页签用 `aria-current="page"` 标记。

上传源文件暂存于 `.crossdoc/uploads/`，解析成功后源 PDF、标准化结构化 JSON 和转换 Markdown 归档在本地 `data/library/<资料 ID>/`。SQLite 保存资料索引与两个模型角色的设置，并在启动时幂等导入已有 `metadata.json` 条目。临时上传在读取任务结束后清理。`data/` 已加入 `.gitignore`，不会进入 Git 提交。资料库页只列出归档文档，不在上传页预览库内文档。

文档的身份是它的内容，而每一次上传都会被保留：内容哈希只是索引，不是唯一约束，重复内容会被标记并折叠成一行，而不是被拒绝或被合并（这与 Paperless-ngx 的做法一致）。「首次归档时间」和「最近使用时间」是两个字段——从资料库再审一次只刷新后者，不再打乱资料库的排序。

审查台现在是一张「工作台」而不只是一次结果：

- 资料库页可以勾选已归档文档直接发起审查（`POST /api/review/from-library`），不必重新上传。
- 每次审查都会存成产物，资料库页下方列出审查记录，`打开` 即用同一份 body 回填审查台（`GET /api/reviews`、`GET /api/reviews/:id`）。
- 冲突清单可按严重度、文档筛选，关键词搜索覆盖标题、理由和引文原文。
- 审查台带「文档对照」面板，两份文档的 Markdown 左右并排。
- 模型配置页的「测试连接」只验连通性，不写库、不污染已保存的配置。

审查口径可以自己定：

- 「我的技能」页可以新建、编辑、导入你自己的领域 skill（比如审招股书、审财报该抽哪些关键数据、什么差异算严重）。
- 它跟项目内置的 skill 分开存放（`data/skills/`，不进 Git），内置的流程和护栏你改不了。
- 审查时 agent 会按文档领域自动加载对应的那一份；没有领域 skill 也能照常审。

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
├── .agents/skills/
│   ├── consistency-review/SKILL.md
│   ├── key-data-alignment/SKILL.md
│   ├── conflict-adjudication/SKILL.md
│   ├── document-overview/SKILL.md
│   └── pdf-reading/SKILL.md
├── public/
│   ├── crossdoc-logo.svg
│   └── index.html
├── src/
│   ├── agent.ts
│   ├── agent-guard.ts
│   ├── cli.ts
│   ├── review-run.ts
│   ├── skills/
│   │   ├── frontmatter.ts
│   │   └── loader.ts
│   ├── core/
│   │   ├── claims.ts
│   │   ├── key-data.ts
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
│       ├── align.ts
│       ├── parse.ts
│       ├── report.ts
│       ├── review-session.ts
│       ├── search-document.ts
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
- 一致性审查由 agent 读 `.agents/skills/` 里的 skill 驱动,代码只提供对齐、校验、渲染这些纯函数能力。
- 审查产物会留存:资料库页可以列出并重新打开历史审查,也可以直接用库里已归档的文档发起一次新审查。
- 审查不再有基于规则的降级路径:skill 需要一个 agent 去读它,所以没有主模型时 `/api/review` 直接返回 503。
- Pi 接入仍隔离在 `src/agent.ts`,格式解析和报告生成不依赖 Pi。

Web 阅读入口、request-scoped Pi Agent、自动概述和引用来源页的后续提问已接通。后续可以在同一 source-location 契约下增加 DOCX、XLSX 与图片加载器。

## 致谢

CrossDoc 构建在 Pi 的最小 agent harness 与扩展哲学之上。向 Pi 项目和维护者致敬：

- Pi 官方源码：https://github.com/earendil-works/pi
