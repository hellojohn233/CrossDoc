# Conflict Ledger

Status: Implementation contract

## Purpose

The conflict ledger is the product's main surface. A review run ends in a ledger: every entry names one contradiction, shows both sides in the source wording, marks the exact differing words, and links back to the page it came from.

## Shape

One column. There is no list pane and no detail pane. Each entry carries its own comparison:

```text
№   冲突标题（衬线）                                    严重度
│   A  文档名 · P2
│      原文引用，差异词加删除线（红）
│   B  文档名 · P2
│      原文引用，差异词加下划线（蓝）
│   判定  一句话说明
│   证据  E1 文档名 P2 打开↗  E2 文档名 P2 打开↗
```

Entries are separated by hairlines and numbered down a continuous vertical rail. The Markdown report sits under the ledger in a folded section with Copy / Download.

## Visual Language

Taken from the `awesome-design-md` collection (`claude`, `wired`, `theverge`, plus `linear.app`, `vercel`, `raycast`, `clickhouse`, `posthog`, `figma`):

- Warm cream canvas, never pure white. The paper grid stays.
- No drop shadows. Structure is carried by 1px hairlines and type.
- 0 radius for structure, 2px for inputs and tags.
- Serif for quoted document language and the entry headline; humanist sans for UI; monospace only for taxonomy — eyebrows, column heads, ids, page numbers — always uppercase with positive tracking.
- One accent colour (blue) for anything interactive. Red and amber mean severity only.
- The diff is a print redline: the A side marks the wording as removed, the B side marks it as added, each on a 12%-alpha tint of its foreground.

## Backend Contract

The ledger consumes exactly the `POST /api/review` response body. Nothing else.

```ts
ReviewResult = {
  documents: { id: string; title: string; sourceUrl?: string }[];
  claimCount: number;             // key data points extracted
  conflictCount: number;
  verifiedConflictCount: number;
  judgeSource: "model" | "rule";   // which stage produced the verdicts
  warning?: string;                // present when the review degraded
  reportMarkdown: string;
  conflicts: Conflict[];
};

Conflict = {
  id: string;
  status: "candidate" | "verified" | "dismissed";
  severity: "high" | "medium" | "low";
  summary: string;      // not rendered
  rationale: string;    // shown as 判定
  score: number;        // not rendered
  judgeSource?: "model" | "rule";
  claims: [Claim, Claim];
  evidence: EvidenceSpan[];
};

EvidenceSpan = {
  id: string;           // claim.evidence[0].id === conflict.evidence[].id
  documentId: string;
  page: number;
  quote: string;
  sourceBlocks: { blockId: string; location: PdfLocation }[];
};
```

Rules the backend owns:

- `summary` and `score` are not displayed. `score` is the adjudicator's confidence that the pair really contradicts; it is not a similarity measure.
- `status` decides which group an entry lands in: `verified` goes to 待处理, everything else to 已排除.
- `severity` is the only severity signal the UI trusts.
- `claim.evidence[0].quote` is the text that gets diffed, so it must be the exact source wording.
- `evidence[].id` must be stable and shared with `claim.evidence[].id`, so an entry can be traced back to a page.
- `judgeSource` and `warning` are informational. The ledger renders the same either way; a rule-only review simply produces fewer, weaker findings.

## Frontend Surface

- `public/js/conflict-ledger.js` — the component. Two layers: pure functions (no DOM, unit tested by `scripts/verify-conflict-diff.mjs`) and rendering (data in, DOM out).
- `public/styles.css` — the ledger styles. `public/index.html` links the same stylesheet.
- `public/ledger-preview.html` — a design preview with mock data, for reviewing the visual direction without a backend.

Integration points in `public/index.html`:

- `applyReviewResult(data)` is the single entry point for a finished review.
- `window.crossdocApplyReviewResult(data)` is exposed for automated checks and for injecting a result from outside the app.
- `onOpenEvidence({ evidenceId })` resolves the evidence and opens the existing PDF page preview with the source blocks highlighted.
