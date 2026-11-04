/**
 * 冲突判定语义验收。
 *
 * 锁住三段式流程的行为边界：召回只负责找候选、判定交给语言模型、校验只负责证据对齐。
 * 不依赖真实模型，用注入的 stub 判定器，保证断言可重复。
 */
import assert from "node:assert/strict";

import { adjudicateCandidates } from "../src/tools/adjudicate.ts";
import { recallCandidates, tokenize } from "../src/tools/recall.ts";
import { ruleAdjudicate } from "../src/tools/rule-adjudicate.ts";
import { verifyConflicts } from "../src/tools/verify.ts";

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

const claim = (id, documentId, value) => ({
  id,
  documentId,
  kind: "fact",
  subject: documentId,
  predicate: "fact",
  value,
  normalizedValue: value.toLowerCase(),
  evidence: [{ id: `${id}:e1`, documentId, page: 1, quote: value, sourceBlocks: [] }],
  confidence: 0.9,
});

const chinese = [
  claim("c1", "doc-a", "甲方不得单方面变更服务范围。"),
  claim("c2", "doc-b", "甲方可以单方面变更服务范围。"),
];
const numeric = [
  claim("n1", "doc-a", "Payment is due within 60 days of invoice."),
  claim("n2", "doc-b", "Payment is due within 90 days of invoice."),
];
const identical = [
  claim("s1", "doc-a", "Master Services Agreement"),
  claim("s2", "doc-b", "Master Services Agreement"),
];

await check("R1 中文按字切分成 bigram，而不是一个整句 token", () => {
  const tokens = tokenize("甲方不得单方面变更服务范围。");
  assert.ok(tokens.includes("甲方"));
  assert.ok(tokens.includes("不得"));
  assert.ok(tokens.length > 5);
});

await check("R2 中文否定相反能被召回，并带 opposite-polarity 信号", () => {
  const candidates = recallCandidates(chinese);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].signals.includes("opposite-polarity"));
});

await check("R3 数值不同能被召回，并带 different-number 信号", () => {
  const candidates = recallCandidates(numeric);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].signals.includes("different-number"));
});

await check("R4 完全相同的表述不进入候选，一致不等于冲突", () => {
  assert.equal(recallCandidates(identical).length, 0);
});

await check("R5 同一份文档内的表述不互相比较", () => {
  const sameDocument = [
    claim("d1", "doc-a", "Payment is due within 60 days of invoice."),
    claim("d2", "doc-a", "Payment is due within 90 days of invoice."),
  ];
  assert.equal(recallCandidates(sameDocument).length, 0);
});

await check("R6 模型判定为冲突时，产出 verified 且保留严重度与置信度", async () => {
  const candidates = recallCandidates(numeric);
  const judgments = await adjudicateCandidates(candidates, {
    complete: async () =>
      JSON.stringify([
        { id: candidates[0].id, conflict: true, severity: "high", confidence: 0.93, summary: "账期不一致", rationale: "两份文件约定的付款期限不同。" },
      ]),
  });
  const conflicts = verifyConflicts(candidates, judgments, { judgeSource: "model" });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, "verified");
  assert.equal(conflicts[0].severity, "high");
  assert.equal(conflicts[0].score, 0.93);
  assert.equal(conflicts[0].judgeSource, "model");
  assert.equal(conflicts[0].evidence[0].id, "n1:e1");
  assert.equal(conflicts[0].evidence[1].id, "n2:e1");
});

await check("R7 模型判定不冲突时，产出 dismissed 而不是 verified", async () => {
  const candidates = recallCandidates(numeric);
  const judgments = await adjudicateCandidates(candidates, {
    complete: async () =>
      JSON.stringify([{ id: candidates[0].id, conflict: false, severity: "medium", confidence: 0.7, summary: "无冲突", rationale: "两份文件的表述可以并存。" }]),
  });
  const conflicts = verifyConflicts(candidates, judgments);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, "dismissed");
  assert.equal(conflicts[0].severity, "low");
});

await check("R8 模型输出带代码围栏或散文时，仍然能解析出判定", async () => {
  const candidates = recallCandidates(numeric);
  const judgments = await adjudicateCandidates(candidates, {
    complete: async () => `这是我的判断：\n\`\`\`json\n${JSON.stringify([
      { id: candidates[0].id, conflict: true, severity: "medium", confidence: 0.8, summary: "账期不一致", rationale: "数值不同。" },
    ])}\n\`\`\`\n以上。`,
  });
  assert.equal(judgments[0].conflict, true);
  assert.equal(judgments[0].severity, "medium");
});

await check("R9 模型漏判的候选按未冲突处理，不误报成冲突", async () => {
  const candidates = recallCandidates(numeric);
  const judgments = await adjudicateCandidates(candidates, { complete: async () => "[]" });
  const conflicts = verifyConflicts(candidates, judgments);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, "dismissed");
  assert.equal(conflicts[0].score, 0);
});

await check("R10 缺少证据的冲突被判为 dismissed，不产出无法引用的结论", () => {
  const broken = { ...numeric[0], evidence: [] };
  const candidates = recallCandidates([broken, numeric[1]]);
  const conflicts = verifyConflicts(candidates, [
    { candidateId: candidates[0].id, conflict: true, severity: "high", confidence: 0.9, summary: "账期不一致", rationale: "数值不同。" },
  ]);
  assert.equal(conflicts[0].status, "dismissed");
  assert.match(conflicts[0].rationale, /Evidence/);
});

await check("R11 没有模型时，规则回退只报显式矛盾，且标为 rule", () => {
  const candidates = recallCandidates(chinese);
  const judgments = ruleAdjudicate(candidates);
  const conflicts = verifyConflicts(candidates, judgments, { judgeSource: "rule" });
  assert.equal(conflicts[0].status, "verified");
  assert.equal(conflicts[0].severity, "high");
  assert.equal(conflicts[0].judgeSource, "rule");

  const quiet = recallCandidates([
    claim("q1", "doc-a", "This Agreement shall be governed by the laws of the State of New York."),
    claim("q2", "doc-b", "This Agreement shall be governed by the laws of the State of Delaware."),
  ]);
  assert.equal(ruleAdjudicate(quiet)[0].conflict, false);
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
