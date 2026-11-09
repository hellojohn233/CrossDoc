/**
 * Checks how the library groups what it has stored.
 *
 * The same content uploaded twice is two archived copies of one document. The
 * list shows one row per document with the copies underneath.
 */
import assert from "node:assert/strict";

import { duplicateCountsByContent, groupLibraryByContent, renderLibraryGroups } from "../public/js/library-groups.js";

const checks = [];
async function check(name, run) {
  try {
    await run();
    checks.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error });
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const document = (id, sha256, uploadedAt) => ({ id, sha256, uploadedAt, title: `doc-${id}` });

await check("G1 同一份内容的两份归档归成一组", async () => {
  const groups = groupLibraryByContent([
    document("b", "hash-a", "2026-11-05T00:00:00.000Z"),
    document("a", "hash-a", "2026-10-27T00:00:00.000Z"),
  ]);
  assert.equal(groups.length, 1, "只有一组");
  assert.equal(groups[0].primary.id, "a", "最早的那份是主条目");
  assert.equal(groups[0].copies.length, 1);
  assert.equal(groups[0].copies[0].id, "b");
});

await check("G2 内容不同的归档各成一组", async () => {
  const groups = groupLibraryByContent([
    document("a", "hash-a", "2026-11-05T00:00:00.000Z"),
    document("b", "hash-b", "2026-11-04T00:00:00.000Z"),
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.copies.length === 0));
});

await check("G3 没有内容哈希的归档各自成组", async () => {
  const groups = groupLibraryByContent([
    { id: "a", uploadedAt: "2026-11-05T00:00:00.000Z" },
    { id: "b", uploadedAt: "2026-11-04T00:00:00.000Z" },
  ]);
  assert.equal(groups.length, 2, "没有哈希的文档不能被当成同一份");
});

await check("G4 主条目是组里最早归档的那份", async () => {
  const groups = groupLibraryByContent([
    document("c", "hash-a", "2026-11-05T00:00:00.000Z"),
    document("a", "hash-a", "2026-10-01T00:00:00.000Z"),
    document("b", "hash-a", "2026-11-01T00:00:00.000Z"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, "a");
  assert.deepEqual(groups[0].copies.map((copy) => copy.id), ["b", "c"]);
});

await check("G5 空文档列表不报错", async () => {
  assert.deepEqual(groupLibraryByContent([]), []);
  assert.deepEqual(groupLibraryByContent(undefined), []);
});

await check("G6 重复计数只统计有内容哈希的文档", async () => {
  const counts = duplicateCountsByContent([
    document("a", "hash-a", "2026-11-05T00:00:00.000Z"),
    document("b", "hash-a", "2026-11-04T00:00:00.000Z"),
    document("c", "hash-b", "2026-11-04T00:00:00.000Z"),
    { id: "d", uploadedAt: "2026-11-04T00:00:00.000Z" },
  ]);
  assert.equal(counts.get("hash-a"), 2);
  assert.equal(counts.get("hash-b"), 1);
  assert.equal(counts.size, 2, "没有哈希的文档不计数");
});

await check("G7 渲染出的列表给重复内容一个提示", async () => {
  const html = renderLibraryGroups([
    { id: "a", sha256: "hash-a", uploadedAt: "2026-10-27T00:00:00.000Z", title: "contract-a.pdf", format: "pdf", pages: 1 },
    { id: "b", sha256: "hash-a", uploadedAt: "2026-11-05T00:00:00.000Z", title: "contract-a.pdf", format: "pdf", pages: 1 },
  ]);
  assert.match(html, /class="library-notice"/, "有重复提示");
  assert.match(html, /1 组内容相同，共 2 份归档/);
  assert.match(html, /另有 1 份相同内容/);
});

await check("G8 副本默认收起，主条目可以勾选", async () => {
  const html = renderLibraryGroups([
    { id: "a", sha256: "hash-a", uploadedAt: "2026-10-27T00:00:00.000Z", title: "a.pdf", format: "pdf", pages: 1 },
    { id: "b", sha256: "hash-a", uploadedAt: "2026-11-05T00:00:00.000Z", title: "a.pdf", format: "pdf", pages: 1 },
  ]);
  assert.equal(html.match(/data-review-pick/g)?.length, 1, "只有主条目能被勾选");
  assert.match(html, /data-review-pick value="a"/);
  assert.match(html, /class="library-copies" data-library-copies="0" hidden/);
});

await check("G9 勾选状态跟着选择走", async () => {
  const html = renderLibraryGroups(
    [{ id: "a", sha256: "hash-a", uploadedAt: "2026-10-27T00:00:00.000Z", title: "a.pdf", format: "pdf", pages: 1 }],
    { picked: (id) => id === "a" },
  );
  assert.match(html, /data-review-pick value="a" checked/);
});

await check("G10 渲染会转义标题里的标记", async () => {
  const html = renderLibraryGroups([
    { id: "x", sha256: "hash-x", uploadedAt: "2026-10-27T00:00:00.000Z", title: '<script>alert("x")</script>', format: "pdf", pages: 1 },
  ]);
  assert.ok(!html.includes("<script>alert"), "标题里的标签被转义了");
  assert.match(html, /&lt;script&gt;/);
});

await check("G11 空库给一个空状态", async () => {
  assert.match(renderLibraryGroups([]), /文档列表还是空的/);
});

await check("G12 最近使用时间和首次归档时间分开显示", async () => {
  const html = renderLibraryGroups([
    {
      id: "a", sha256: "hash-a", uploadedAt: "2026-10-27T00:00:00.000Z", lastUsedAt: "2026-11-05T00:00:00.000Z",
      title: "a.pdf", format: "pdf", pages: 1,
    },
  ]);
  assert.match(html, /最近使用/, "显示了最近使用时间");
});

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  for (const entry of failed) console.error(`\n${entry.name}\n${entry.error?.stack ?? entry.error}`);
  process.exit(1);
}
