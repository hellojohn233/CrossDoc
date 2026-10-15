import assert from "node:assert/strict";

import { SearchDocumentInputError, searchDocument, searchDocumentLimits } from "../src/tools/search-document.ts";

const document = {
  id: "contract-1",
  title: "采购合同.pdf",
  format: "pdf",
  pages: [],
  text: "",
  markdown: "",
  warnings: [],
  blocks: [
    {
      id: "contract-1:p1:b1",
      kind: "text",
      text: "本合同约定采购设备的交付日期为2026年11月30日。",
      source: { type: "pdf", page: 1, bbox: [10, 20, 100, 40], pageBounds: [0, 0, 600, 800] },
      start: 0,
      end: 25,
    },
    {
      id: "contract-1:p3:b2",
      kind: "text",
      text: "逾期交付的违约金按合同总价的百分之五计算。",
      source: { type: "pdf", page: 3, bbox: [10, 50, 300, 70], pageBounds: [0, 0, 600, 800] },
      start: 0,
      end: 22,
    },
    {
      id: "contract-1:p4:b3",
      kind: "text",
      text: "The warranty period is twelve months from delivery.",
      source: { type: "pdf", page: 4, bbox: [10, 50, 300, 70], pageBounds: [0, 0, 600, 800] },
      start: 0,
      end: 52,
    },
  ],
};

const ranked = searchDocument({ query: "合同交付日期", documents: [document] });
assert.equal(ranked.status, "matches");
assert.equal(ranked.excerpts[0]?.source.blockId, "contract-1:p1:b1", "Chinese lexical match ranks relevant block first");
assert.deepEqual(ranked.excerpts[0]?.source.location, document.blocks[0].source, "source location is preserved");

const english = searchDocument({ query: "warranty period", documents: [document] });
assert.equal(english.status, "matches");
assert.equal(english.excerpts[0]?.source.location.page, 4, "English tokens are searchable too");

const capped = searchDocument({ query: "合同", documents: [document], maxResults: 1 });
assert.equal(capped.status, "matches");
assert.equal(capped.excerpts.length, 1, "caller result limit is applied");

const longDocument = {
  ...document,
  blocks: [{
    ...document.blocks[0],
    id: "contract-1:p5:b1",
    text: `${"无关背景信息。".repeat(100)}关键交付地点位于上海。${"补充内容。".repeat(100)}`,
  }],
};
const boundedExcerpt = searchDocument({ query: "关键交付地点", documents: [longDocument] });
assert.equal(boundedExcerpt.status, "matches");
assert.ok([...boundedExcerpt.excerpts[0].excerpt].length <= searchDocumentLimits.maxExcerptCharacters, "excerpt length is bounded");
assert.ok(boundedExcerpt.excerpts[0].excerpt.includes("关键交付地点"), "long-block excerpt includes matched context");

const noMatch = searchDocument({ query: "不存在的专利编号", documents: [document] });
assert.deepEqual(noMatch, { status: "no-match", query: "不存在的专利编号", excerpts: [] });

assert.throws(() => searchDocument({ query: "  ", documents: [document] }), SearchDocumentInputError);
assert.throws(() => searchDocument({ query: "合同", documents: [document], maxResults: 9 }), SearchDocumentInputError);

console.log("PASS: Chinese and English matching, rank order, result cap, source reference, no-match, and input validation");
