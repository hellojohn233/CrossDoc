/**
 * 冲突清单前端纯函数验收。
 * 覆盖 public/js/conflict-ledger.js 的差异识别能力，不依赖浏览器和后端。
 */
import assert from "node:assert/strict";

import {
  buildLedgerModel,
  describeConflict,
  detectPolarity,
  diffTokens,
  extractValues,
  splitTokens,
} from "../public/js/conflict-ledger.js";

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

check("A1 完全相同的文本没有差异片段", () => {
  const diff = diffTokens("Master Services Agreement", "Master Services Agreement");
  assert.equal(diff.identical, true);
  assert.equal(diff.left.every((segment) => segment.type === "same"), true);
  assert.equal(diff.right.every((segment) => segment.type === "same"), true);
});

check("A2 数值不同能被定位到具体片段", () => {
  const diff = diffTokens("Payment is due within 60 days of invoice.", "Payment is due within 90 days of invoice.");
  const leftDiff = diff.left.filter((segment) => segment.type === "diff").map((segment) => segment.text.trim());
  const rightDiff = diff.right.filter((segment) => segment.type === "diff").map((segment) => segment.text.trim());
  assert.deepEqual(leftDiff, ["60"]);
  assert.deepEqual(rightDiff, ["90"]);
});

check("A3 中文按字切分并合并高亮片段", () => {
  const diff = diffTokens("甲方不得单方面变更服务范围。", "甲方可以单方面变更服务范围。");
  const leftDiff = diff.left.filter((segment) => segment.type === "diff").map((segment) => segment.text.trim());
  const rightDiff = diff.right.filter((segment) => segment.type === "diff").map((segment) => segment.text.trim());
  assert.deepEqual(leftDiff, ["不得"]);
  assert.deepEqual(rightDiff, ["可以"]);
});

check("A4 英文词尾标点不被拆散", () => {
  const tokens = splitTokens("Bright Harbor Ltd.").map((token) => token.text);
  assert.equal(tokens.includes("Ltd."), true);
});

check("A5 数值提取带上单位", () => {
  const values = extractValues("本协议保密期限为 3 年。");
  const number = values.find((value) => value.kind === "number");
  assert.ok(number, "应提取到数值");
  assert.equal(number.value, 3);
  assert.equal(number.unit, "年");
});

check("A6 同一日期的不同写法归一化后相等", () => {
  const left = extractValues("协议生效日期为 2025 年 1 月 1 日。").find((value) => value.kind === "date");
  const right = extractValues("协议生效日期为 2025-01-01。").find((value) => value.kind === "date");
  assert.ok(left && right, "两侧都应提取到日期");
  assert.equal(left.value, right.value);
});

check("A7 否定与允许能被识别为相反极性", () => {
  const left = detectPolarity("甲方不得单方面变更服务范围。");
  const right = detectPolarity("甲方可以单方面变更服务范围。");
  assert.equal(left.some((item) => item.kind === "prohibit"), true);
  assert.equal(right.some((item) => item.kind === "allow"), true);
});

const mockClaim = (id, documentId, quote) => ({
  id,
  documentId,
  value: quote,
  evidence: [{ id: `${id}:e1`, documentId, page: 1, quote, sourceBlocks: [] }],
});

check("A8 描述器把数值冲突判为 value", () => {
  const description = describeConflict({
    claims: [
      mockClaim("a", "doc-a", "Payment is due within 60 days of invoice."),
      mockClaim("b", "doc-b", "Payment is due within 90 days of invoice."),
    ],
  });
  assert.equal(description.kind, "value");
  assert.match(description.title, /60/);
  assert.match(description.title, /90/);
});

check("A9 描述器把相反表述判为 polarity", () => {
  const description = describeConflict({
    claims: [
      mockClaim("a", "doc-a", "甲方不得单方面变更服务范围。"),
      mockClaim("b", "doc-b", "甲方可以单方面变更服务范围。"),
    ],
  });
  assert.equal(description.kind, "polarity");
});

check("A10 描述器把逐字相同判为 identical", () => {
  const description = describeConflict({
    claims: [
      mockClaim("a", "doc-a", "Master Services Agreement"),
      mockClaim("b", "doc-b", "Master Services Agreement"),
    ],
  });
  assert.equal(description.kind, "identical");
});

check("A11 视图模型按待处理与已排除分组并按严重度排序", () => {
  const model = buildLedgerModel({
    documents: [{ id: "doc-a", title: "A.pdf" }],
    claimCount: 12,
    conflicts: [
      { id: "c1", status: "verified", severity: "low", summary: "", rationale: "", claims: [], evidence: [] },
      { id: "c2", status: "dismissed", severity: "high", summary: "", rationale: "", claims: [], evidence: [] },
      { id: "c3", status: "verified", severity: "high", summary: "", rationale: "", claims: [], evidence: [] },
    ],
  });
  assert.equal(model.stats.pending, 2);
  assert.equal(model.stats.dismissed, 1);
  assert.equal(model.groups[0].items[0].id, "c3");
});

let failed = 0;
for (const entry of checks) {
  if (entry.ok) {
    console.log(`  ok  ${entry.name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${entry.name}\n       ${entry.message}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exit(1);
