/**
 * 关键数据对齐语义验收。
 *
 * 锁住三段式流程的行为边界：模型抽关键数据 → 按 key 对齐 → 模型判定 → 证据校验。
 * 不依赖真实模型，用注入的 stub 判定器，保证断言可重复。
 */
import assert from "node:assert/strict";

import { adjudicatePairs } from "../src/tools/adjudicate.ts";
import {
  alignKeyData,
  expandAlignedPairs,
  parseKeyExtractionResponse,
} from "../src/tools/key-data.ts";
import { ruleAdjudicatePairs } from "../src/tools/rule-adjudicate.ts";
import { extractKeyDataByRules } from "../src/tools/rule-key-data.ts";
import { verifyConflicts } from "../src/tools/verify.ts";
import { KEY_TAXONOMY, normalizeValue } from "../src/core/key-data.ts";

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

const keyItem = (documentId, key, value, quote = `${key}: ${value}`) => ({
  id: `${documentId}:${key}:1`,
  documentId,
  key,
  label: key,
  value,
  quote,
  page: 1,
  confidence: 0.8,
  custom: false,
});

const document = (id, text) => ({
  id,
  title: `${id}.pdf`,
  format: "pdf",
  pages: [{ page: 1, text, blocks: [] }],
  blocks: [],
  text,
  markdown: text,
  warnings: [],
});

await check("K1 关键数据词表是固定的，且能识别词表内的 key", () => {
  assert.ok(KEY_TAXONOMY.length >= 20);
  assert.ok(KEY_TAXONOMY.some((entry) => entry.key === "payment_term"));
  assert.ok(KEY_TAXONOMY.some((entry) => entry.key === "contract_value"));
});

await check("K2 抽取结果能解析，且词表内的 key 与自定义 key 分别标记", () => {
  const parsed = parseKeyExtractionResponse(
    JSON.stringify([
      { key: "payment_term", value: "45 days", quote: "Pay within 45 days.", page: 1 },
      { key: "warranty_period", value: "12 months", quote: "Warranty is 12 months.", page: 2 },
    ]),
    "doc-a",
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].key, "payment_term");
  assert.equal(parsed[0].custom, false);
  assert.equal(parsed[1].key, "warranty_period");
  assert.equal(parsed[1].custom, true);
  assert.equal(parsed[0].page, 1);
});

await check("K3 抽取结果包在代码围栏或散文里也能解析", () => {
  const parsed = parseKeyExtractionResponse(
    `这是抽取结果：\n\`\`\`json\n${JSON.stringify([{ key: "effective_date", value: "March 1, 2026", quote: "Takes effect on March 1, 2026.", page: 1 }])}\n\`\`\`\n以上。`,
    "doc-a",
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].value, "March 1, 2026");
});

await check("K4 同一个 key 的数据在不同文档之间对齐，不靠字面共享词", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days"),
    keyItem("doc-b", "payment_term", "90 days"),
    keyItem("doc-a", "contract_value", "USD 120000"),
  ]);
  const payment = groups.find((group) => group.key === "payment_term");
  assert.ok(payment, "付款期限应当对齐成一组");
  assert.equal(payment.items.length, 2);
  assert.equal(payment.consistent, false);
  assert.deepEqual(payment.values.sort(), ["45 days", "90 days"]);
});

await check("K5 一份文档对同一个 key 只保留一个值，取信息量最大的那个", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "confidentiality", "all disclosed information"),
    { ...keyItem("doc-a", "confidentiality", "maintain confidentiality of all disclosed information"), id: "doc-a:confidentiality:2" },
  ]);
  const group = groups.find((entry) => entry.key === "confidentiality");
  assert.equal(group.items.length, 1);
  assert.equal(group.items[0].value, "maintain confidentiality of all disclosed information");
});

await check("K6 取值相同的 key 不产生待判定对", () => {
  const groups = alignKeyData([
    keyItem("doc-a", "term_length", "twelve months"),
    keyItem("doc-b", "term_length", "twelve months"),
  ]);
  assert.equal(groups[0].consistent, true);
  assert.equal(expandAlignedPairs(groups).length, 0);
});

await check("K7 取值不同的 key 产生待判定对，且带上整组取值", () => {
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

await check("K8 取值归一化忽略标点、冠词和多余的零", () => {
  assert.equal(normalizeValue("The analytics platform."), normalizeValue("analytics platform"));
  assert.equal(normalizeValue("USD 1,200.0"), normalizeValue("usd 1200"));
  assert.notEqual(normalizeValue("45 days"), normalizeValue("90 days"));
});

await check("K9 模型判定为冲突时产出 verified，判定不冲突时产出 dismissed", async () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days"),
    keyItem("doc-b", "payment_term", "90 days"),
  ]);
  const pairs = expandAlignedPairs(groups);

  const verified = verifyConflicts(
    pairs,
    await adjudicatePairs(pairs, {
      complete: async () =>
        JSON.stringify([{ id: pairs[0].id, conflict: true, severity: "high", confidence: 0.93, summary: "账期不一致", rationale: "付款期限不同。" }]),
    }),
    { judgeSource: "model" },
  );
  assert.equal(verified[0].status, "verified");
  assert.equal(verified[0].severity, "high");
  assert.equal(verified[0].score, 0.93);
  assert.equal(verified[0].judgeSource, "model");
  assert.equal(verified[0].evidence.length, 2);

  const dismissed = verifyConflicts(
    pairs,
    await adjudicatePairs(pairs, {
      complete: async () =>
        JSON.stringify([{ id: pairs[0].id, conflict: false, severity: "medium", confidence: 0.8, summary: "无冲突", rationale: "两者可以并存。" }]),
    }),
  );
  assert.equal(dismissed[0].status, "dismissed");
  assert.equal(dismissed[0].severity, "low");
});

await check("K10 模型漏判的候选按未冲突处理，不误报成冲突", async () => {
  const groups = alignKeyData([
    keyItem("doc-a", "payment_term", "45 days"),
    keyItem("doc-b", "payment_term", "90 days"),
  ]);
  const pairs = expandAlignedPairs(groups);
  const conflicts = verifyConflicts(pairs, await adjudicatePairs(pairs, { complete: async () => "[]" }));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, "dismissed");
  assert.equal(conflicts[0].score, 0);
});

await check("K11 引文为空的冲突被判为 dismissed，不产出无法引用的结论", () => {
  const groups = alignKeyData([
    { ...keyItem("doc-a", "payment_term", "45 days"), quote: "" },
    keyItem("doc-b", "payment_term", "90 days"),
  ]);
  const pairs = expandAlignedPairs(groups);
  const conflicts = verifyConflicts(pairs, [
    { candidateId: pairs[0].id, conflict: true, severity: "high", confidence: 0.9, summary: "账期不一致", rationale: "付款期限不同。" },
  ]);
  assert.equal(conflicts[0].status, "dismissed");
  assert.match(conflicts[0].rationale, /Evidence/);
});

await check("K12 没有模型时的规则回退：抽得到关键数据，并只报取值不同的 key", () => {
  const text = [
    "Agreement between Northwind Analytics and Bright Harbor Ltd.",
    "The Client shall pay all undisputed invoices within 45 days of receipt.",
    "The total contract value is USD 120000 including delivery and support.",
    "This Agreement takes effect on March 1, 2026 and continues for twelve months.",
  ].join("\n");
  const items = extractKeyDataByRules(document("doc-a", text));
  const keys = items.map((item) => item.key);
  assert.ok(keys.includes("contract_subject"));
  assert.ok(keys.includes("payment_term"));
  assert.ok(keys.includes("contract_value"));
  assert.ok(keys.includes("effective_date"));

  const pairs = expandAlignedPairs(
    alignKeyData([...items, keyItem("doc-b", "payment_term", "90 days")]),
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, "payment_term");
  const judgments = ruleAdjudicatePairs(pairs);
  assert.equal(judgments[0].conflict, true);
  const conflicts = verifyConflicts(pairs, judgments, { judgeSource: "rule" });
  assert.equal(conflicts[0].judgeSource, "rule");
  assert.equal(conflicts[0].status, "verified");
});

await check("K13 端到端：抽取 → 对齐 → 判定 → 校验，只留下真冲突", async () => {
  const extracted = {
    "doc-a": [
      { key: "payment_term", value: "45 days", quote: "The Client shall pay all undisputed invoices within 45 days of receipt." },
      { key: "contract_value", value: "USD 120000", quote: "The total contract value is USD 120000 including delivery and support." },
      { key: "confidentiality", value: "all disclosed information", quote: "Each party shall maintain confidentiality of all disclosed information." },
    ],
    "doc-b": [
      { key: "payment_term", value: "90 days", quote: "The Client shall pay all undisputed invoices within 90 days of receipt." },
      { key: "contract_value", value: "USD 150000", quote: "The total contract value is USD 150000 including delivery and support." },
      { key: "confidentiality", value: "maintain confidentiality of all disclosed information", quote: "Each party shall maintain confidentiality of all disclosed information." },
    ],
  };
  const complete = async (prompt) => {
    const items = Object.entries(extracted).find(([, values]) => prompt.includes(values[0].quote));
    const payload = items
      ? items[1].map((item) => ({ ...item, page: 1 }))
      : [];
    return JSON.stringify(payload.map((item) => ({ ...item, page: 1 })));
  };

  const { extractKeyData } = await import("../src/tools/key-data.ts");
  const items = [];
  for (const id of ["doc-a", "doc-b"]) {
    items.push(...(await extractKeyData(document(id, extracted[id].map((item) => item.quote).join("\n")), { complete })));
  }
  const pairs = expandAlignedPairs(alignKeyData(items));
  assert.equal(pairs.length, 3);

  const judgments = await adjudicatePairs(pairs, {
    complete: async () =>
      JSON.stringify(
        pairs.map((pair) => ({
          id: pair.id,
          conflict: pair.key !== "confidentiality",
          severity: "high",
          confidence: 0.9,
          summary: `${pair.label} 不一致`,
          rationale: "两份文件对该 key 的取值不同。",
        })),
      ),
  });
  const conflicts = verifyConflicts(pairs, judgments, { judgeSource: "model" });
  assert.equal(conflicts.length, 3);
  assert.equal(conflicts.filter((conflict) => conflict.status === "verified").length, 2);
  assert.equal(conflicts.filter((conflict) => conflict.status === "dismissed").length, 1);
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
