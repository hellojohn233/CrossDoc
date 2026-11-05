/**
 * 关键数据一致性审查验收。
 *
 * 审查流程本身住在 .agents/skills/ 里，由一个 agent 读 skill 后一步步调工具。
 * 这个脚本锁住三件事：
 *   1. skill 文件是流程的所在，而且内容真的写清了步骤与判据；
 *   2. 对齐与校验这两个纯函数的行为边界；
 *   3. 整条链路真的由 agent 驱动 —— 用脚本化的模型把工具调用喂进去，
 *      断言跑完之后的冲突清单是不是预期的那个。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { alignKeyData, expandAlignedPairs } from "../src/tools/align.ts";
import { normalizeJudgment, verifyConflicts } from "../src/tools/verify.ts";
import { runConsistencyReview } from "../src/review-run.ts";
import { createToolCallGuard, TOOL_CALL_LIMITS } from "../src/agent-guard.ts";
import { KEY_TAXONOMY, normalizeValue } from "../src/core/key-data.ts";
import { parseFrontmatter } from "../src/skills/frontmatter.ts";

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

const skillRoot = resolve(process.cwd(), ".agents/skills");
const readSkill = (name) => readFile(resolve(skillRoot, name, "SKILL.md"), "utf8");

const keyItem = (documentId, key, value, quote = `${key}: ${value}`, page = 1) => ({
  id: `${documentId}:${key}:1`,
  documentId,
  key,
  label: key,
  value,
  quote,
  page,
  confidence: 0.9,
  custom: false,
});

// ── 1. skill 是流程的所在 ────────────────────────────────────
await check("S1 三个审查 skill 都在，front-matter 的 name 与目录名一致", async () => {
  for (const name of ["consistency-review", "key-data-alignment", "conflict-adjudication"]) {
    const content = await readSkill(name);
    const { frontmatter, warnings } = parseFrontmatter(content);
    assert.deepEqual(warnings, [], `${name} 的 front-matter 有问题`);
    assert.equal(frontmatter.name, name, `${name} 的 front-matter name 与目录名不一致`);
    assert.ok(frontmatter.description?.trim(), `${name} 缺少 description`);
  }
});

await check("S2 consistency-review 写清了步骤，并且会加载另外两个 skill", async () => {
  const content = await readSkill("consistency-review");
  assert.match(content, /parse_document/);
  assert.match(content, /render_scan_page/, "扫描页必须先读，否则未读的页看起来就像一致");
  assert.match(content, /key-data-alignment/);
  assert.match(content, /conflict-adjudication/);
  assert.match(content, /do not substitute a text diff/i);
});

await check("S3 key-data-alignment 规定取口径与引文的写法", async () => {
  const content = await readSkill("key-data-alignment");
  assert.match(content, /list_key_vocabulary/);
  assert.match(content, /align_key_data/);
  assert.match(content, /only the value/i);
  assert.match(content, /verbatim/i);
});

await check("S4 conflict-adjudication 规定什么时候才算冲突，以及怎么报", async () => {
  const content = await readSkill("conflict-adjudication");
  assert.match(content, /verify_conflicts/);
  assert.match(content, /report_conflicts/);
  assert.match(content, /conflict: true/);
  assert.match(content, /conflict: false/);
  assert.match(content, /severity/);
});

await check("S5 固定口径是一份受控词表", () => {
  assert.ok(KEY_TAXONOMY.length >= 20);
  assert.ok(KEY_TAXONOMY.some((entry) => entry.key === "payment_term"));
  assert.ok(KEY_TAXONOMY.every((entry) => /^[a-z_]+$/.test(entry.key)), "key 必须是稳定的 slug");
});

// ── 2. 纯函数的行为边界 ──────────────────────────────────────
await check("A1 同一个 key 的数据在不同文档之间对齐，不靠字面共享词", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days"),
    keyItem("doc-b", "payment_term", "90 days"),
    keyItem("doc-a", "contract_value", "USD 120000"),
  ]);
  const payment = groups.find((group) => group.key === "payment_term");
  assert.ok(payment, "付款期限应当对齐成一组");
  assert.equal(payment.items.length, 2);
  assert.equal(payment.consistent, false);
});

await check("A2 一份文档对同一个 key 只保留一个值", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "confidentiality", "all disclosed information"),
    { ...keyItem("doc-a", "confidentiality", "maintain confidentiality of all disclosed information"), id: "doc-a:confidentiality:2" },
  ]);
  const group = groups.find((entry) => entry.key === "confidentiality");
  assert.equal(group.items.length, 1);
  assert.equal(group.items[0].value, "maintain confidentiality of all disclosed information");
});

await check("A3 取值相同的 key 不产生待判定对", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "term_length", "twelve months"),
    keyItem("doc-b", "term_length", "twelve months"),
  ]);
  assert.equal(groups[0].consistent, true);
  assert.equal(expandAlignedPairs(groups).length, 0);
});

await check("A4 取值不同的 key 产生待判定对，且带上整组取值", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days"),
    keyItem("doc-b", "payment_term", "90 days"),
    keyItem("doc-c", "payment_term", "45 days"),
  ]);
  const pairs = expandAlignedPairs(groups);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, "payment_term");
  assert.notEqual(pairs[0].left.documentId, pairs[0].right.documentId);
  assert.equal(pairs[0].group.length, 3);
});

await check("A5 取值归一化忽略标点、千分位、冠词和多余的零", () => {
  assert.equal(normalizeValue("The analytics platform."), normalizeValue("analytics platform"));
  assert.equal(normalizeValue("USD 1,200.0"), normalizeValue("usd 1200"));
  assert.notEqual(normalizeValue("45 days"), normalizeValue("90 days"));
});

await check("A6 引文对不上的冲突被判为 dismissed", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days", "原文中并没有这一句"),
    keyItem("doc-b", "payment_term", "90 days"),
  ]);
  const pairs = expandAlignedPairs(groups);
  const conflicts = verifyConflicts(pairs, [
    { candidateId: pairs[0].id, conflict: true, severity: "high", confidence: 0.9, summary: "账期不一致", rationale: "付款期限不同。" },
  ], {
    documents: new Map([["doc-a", { id: "doc-a", title: "a", format: "pdf", pages: [], blocks: [], text: "完全不同的正文。", markdown: "", warnings: [] }]]),
  });
  assert.equal(conflicts[0].status, "dismissed");
  assert.match(conflicts[0].rationale, /not found in the source text/);
});

await check("A7 模型给的判定字段会被归一化，脏字段不会炸掉整次审查", () => {
  const messy = normalizeJudgment({
    candidate_id: "pair-1",
    conflict: "true",
    severity: "catastrophic",
    confidence: "92%",
    summary: "金额不一致",
    reason: "两处金额不同。",
  });
  assert.equal(messy.candidateId, "pair-1");
  assert.equal(messy.conflict, true);
  assert.equal(messy.severity, "medium", "不认识的严重度退回 medium");
  assert.equal(messy.confidence, 0.92, "百分比写法的置信度被归一化到 0-1");
  assert.equal(messy.rationale, "两处金额不同。");
  assert.equal(normalizeJudgment({ confidence: 0.5 }), undefined, "没有 candidateId 的判定被丢掉");
  assert.equal(normalizeJudgment({ candidateId: "p", confidence: "abc" }).confidence, 0.5);
});

// ── 3. 整条链路由 agent 驱动 ────────────────────────────────
const fakeText = (title) =>
  title.includes("乙")
    ? "The Client shall pay all undisputed invoices within 90 days of receipt."
    : "The Client shall pay all undisputed invoices within 45 days of receipt.";

const fakeDocument = (id, title) => {
  const text = fakeText(title);
  return {
    id,
    title,
    format: "pdf",
    pages: [{ page: 1, text, blocks: [], classification: "text-native", extractionMethod: "native-text" }],
    blocks: [],
    text,
    markdown: `# ${title}\n\n${text}\n`,
    warnings: [],
  };
};

function makeModels() {
  const model = (id, input) => ({
    id,
    name: `Scripted ${id}`,
    api: "openai-responses",
    provider: "test-provider",
    baseUrl: "https://unused.invalid",
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 32_000,
    maxTokens: 2_000,
  });
  const main = model("main-text", ["text"]);
  const vision = model("vision-test", ["text", "image"]);
  return {
    getModel: (provider, id) => (provider === "test-provider" ? (id === "main-text" ? main : id === "vision-test" ? vision : undefined) : undefined),
    checkAuth: async (provider) => (provider === "test-provider" ? { type: "api_key" } : undefined),
  };
}

const visionProfile = { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "scripted-key" };

function scriptedStream(content, stopReason) {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: stopReason === "toolUse" ? "toolUse" : "stop",
    message: {
      role: "assistant",
      content,
      api: "openai-responses",
      provider: "test-provider",
      model: "main-text",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason,
      timestamp: Date.now(),
    },
  });
  return stream;
}

const toolCall = (name, args) => ({ type: "toolCall", id: `call-${name}-${Math.random().toString(16).slice(2)}`, name, arguments: args });

const documents = [
  { id: "doc-a", title: "合同甲.pdf", path: "/tmp/contract-a.pdf" },
  { id: "doc-b", title: "合同乙.pdf", path: "/tmp/contract-b.pdf" },
];

const quoteA = "The Client shall pay all undisputed invoices within 45 days of receipt.";
const quoteB = "The Client shall pay all undisputed invoices within 90 days of receipt.";
const items = [
  { documentId: "doc-a", key: "payment_term", value: "45 days", quote: quoteA, page: 1 },
  { documentId: "doc-b", key: "payment_term", value: "90 days", quote: quoteB, page: 1 },
];

const scriptedCalls = [
  toolCall("inspect_document", { documentId: "doc-a" }),
  toolCall("inspect_document", { documentId: "doc-b" }),
  toolCall("parse_document", { documentId: "doc-a" }),
  toolCall("parse_document", { documentId: "doc-b" }),
  // The review procedure itself is injected, so the agent loads the two steps
  // it is made of, in order.
  toolCall("load_document_skill", { skill: "key-data-alignment" }),
  toolCall("load_document_skill", { skill: "conflict-adjudication" }),
  toolCall("list_key_vocabulary", {}),
  toolCall("align_key_data", { items }),
  // The pairs are not repeated here: the tool takes them from the session.
  toolCall("verify_conflicts", {
    judgments: [{ candidateId: "pair-1", conflict: true, severity: "high", confidence: 0.94, summary: "付款期限不一致", rationale: "两份协议约定的付款期限不同。" }],
  }),
  toolCall("report_conflicts", {}),
];

await check("B1 agent 按 skill 走完流程，产出冲突清单", async () => {
  const models = makeModels();
  let index = 0;
  let firstContext = "";
  models.streamSimple = (_model, context) => {
    if (!firstContext) firstContext = JSON.stringify(context);
    const call = scriptedCalls[index++];
    if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
    return scriptedStream([call], "toolUse");
  };

  const seen = [];
  const result = await runConsistencyReview({
    documents,
    models,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" },
    visionProfile,
    parseDocument: async (_path, options) => fakeDocument(options.id, options.title),
    onDocumentUpdated: (document) => seen.push(document.id),
    onStage: (tool) => seen.push(tool),
  });

  assert.ok(seen.includes("consistency-review") === false, "skill 名称不是工具名");
  assert.ok(seen.includes("load_document_skill"));
  assert.ok(seen.includes("align_key_data"));
  assert.ok(seen.includes("verify_conflicts"));

  assert.equal(result.documents.length, 2, "两份文档都被解析并归档");
  assert.equal(result.claims.length, 2, "两项关键数据");
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].status, "verified");
  assert.equal(result.conflicts[0].severity, "high");
  assert.equal(result.conflicts[0].score, 0.94);
  assert.equal(result.conflicts[0].claims[0].evidence[0].quote, quoteA);
  assert.equal(result.conflicts[0].claims[1].evidence[0].quote, quoteB);
  assert.ok(result.stages.includes("align_key_data"));
  assert.ok(result.stages.includes("verify_conflicts"));
  assert.match(result.reportMarkdown, /CrossDoc Consistency Review/);
});

await check("B1b 审查流程在第一轮就把 skill 正文注入对话", async () => {
  const models = makeModels();
  let index = 0;
  let firstContext = "";
  models.streamSimple = (_model, context) => {
    if (!firstContext) firstContext = JSON.stringify(context);
    const call = scriptedCalls[index++];
    if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
    return scriptedStream([call], "toolUse");
  };

  await runConsistencyReview({
    documents,
    models,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" },
    visionProfile,
    parseDocument: async (_path, options) => fakeDocument(options.id, options.title),
  });

  assert.match(firstContext, /<skill name=\\"consistency-review\\"/, "第一轮对话里没有审查 skill 的正文");
  assert.match(firstContext, /render_scan_page/, "注入的正文应当包含审查步骤");
  assert.match(firstContext, /<available_skills>/, "系统提示里应当有 skill 索引");
});

await check("B2 引文在原文里找不到的结论不会进清单", async () => {
  const models = makeModels();
  const forged = [
    { documentId: "doc-a", key: "payment_term", value: "45 days", quote: "这句原文里根本没有。", page: 1 },
    { documentId: "doc-b", key: "payment_term", value: "90 days", quote: quoteB, page: 1 },
  ];
  const calls = scriptedCalls.map((call) =>
    call.name === "align_key_data"
      ? toolCall("align_key_data", { items: forged })
      : call);
  let index = 0;
  models.streamSimple = () => {
    const call = calls[index++];
    if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
    return scriptedStream([call], "toolUse");
  };

  const result = await runConsistencyReview({
    documents,
    models,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" },
    visionProfile,
    parseDocument: async (_path, options) => fakeDocument(options.id, options.title),
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].status, "dismissed");
  assert.equal(result.conflicts[0].severity, "low");
});

await check("B3 report_conflicts 反复调用会被护栏挡住，审查不会死循环", async () => {
  const models = makeModels();
  const calls = [
    toolCall("inspect_document", { documentId: "doc-a" }),
    toolCall("inspect_document", { documentId: "doc-b" }),
    toolCall("parse_document", { documentId: "doc-a" }),
    toolCall("parse_document", { documentId: "doc-b" }),
    toolCall("align_key_data", { items }),
    toolCall("verify_conflicts", {
      judgments: [{ candidateId: "pair-1", conflict: true, severity: "high", confidence: 0.9, summary: "付款期限不一致", rationale: "付款期限不同。" }],
    }),
    toolCall("report_conflicts", {}),
    toolCall("report_conflicts", {}),
    toolCall("report_conflicts", {}),
    toolCall("report_conflicts", {}),
    toolCall("report_conflicts", {}),
  ];
  let index = 0;
  let reportCalls = 0;
  models.streamSimple = () => {
    const call = calls[index++];
    if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
    if (call.name === "report_conflicts") reportCalls += 1;
    return scriptedStream([call], "toolUse");
  };

  const result = await runConsistencyReview({
    documents,
    models,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" },
    visionProfile,
    parseDocument: async (_path, options) => fakeDocument(options.id, options.title),
  });

  assert.ok(reportCalls <= 3, `report_conflicts 被调用了 ${reportCalls} 次，护栏没有生效`);
  assert.equal(result.conflicts.length, 1, "挡下来的重复调用不影响已经产生的结论");
  assert.equal(result.conflicts[0].status, "verified");
});

await check("B4 护栏按工具分别限次，超出的调用会被挡下", async () => {
  const guard = createToolCallGuard();
  const context = (name) => ({ toolCall: { name }, args: {}, assistantMessage: {}, context: {} });
  const limit = TOOL_CALL_LIMITS.list_key_vocabulary;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(await guard.beforeToolCall(context("list_key_vocabulary")), undefined, `第 ${index + 1} 次不该被挡`);
  }
  const blocked = await guard.beforeToolCall(context("list_key_vocabulary"));
  assert.equal(blocked.block, true);
  assert.equal(blocked.terminate, true);
  assert.match(blocked.reason, /list_key_vocabulary/);
  assert.equal(guard.counts().list_key_vocabulary, limit + 1);
});

let failed = 0;
for (const result of checks) {
  if (result.ok) {
    console.log(`  ok  ${result.name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${result.name}\n       ${result.message}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exit(1);
