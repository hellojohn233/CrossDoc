/**
 * Checks that a skill reads like the Markdown it was written in.
 *
 * The skill page shows the body of a skill as rendered Markdown, and the
 * text in a skill can come from a file the user brought along. So the
 * renderer has to mark up the Markdown correctly and leave the text alone.
 */
import assert from "node:assert/strict";

import { escapeMarkdownHtml, renderMarkdown } from "../public/js/markdown.js";

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

await check("标题按层级渲染", () => {
  const html = renderMarkdown("# 一级\n\n## 二级\n\n### 三级");
  assert.match(html, /<h1>一级<\/h1>/);
  assert.match(html, /<h2>二级<\/h2>/);
  assert.match(html, /<h3>三级<\/h3>/);
});

await check("段落是一段", () => {
  const html = renderMarkdown("这是一段话。");
  assert.match(html, /<p>这是一段话。<\/p>/);
});

await check("无序列表和有序列表", () => {
  const html = renderMarkdown("- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二");
  assert.match(html, /<ul>\s*<li>第一项<\/li>\s*<li>第二项<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>\s*<li>步骤一<\/li>\s*<li>步骤二<\/li>\s*<\/ol>/);
});

await check("行内的粗体、斜体和代码", () => {
  const html = renderMarkdown("这里有 **粗体**、*斜体* 和 `inspect_document`。");
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>inspect_document<\/code>/);
});

await check("代码块原样保留", () => {
  const html = renderMarkdown("```js\nconst a = 1 < 2;\n```");
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const a = 1 &lt; 2;/);
});

await check("引用块", () => {
  const html = renderMarkdown("> 引用的那一句话。");
  assert.match(html, /<blockquote><p>引用的那一句话。<\/p><\/blockquote>/);
});

await check("水平线", () => {
  assert.match(renderMarkdown("---"), /<hr \/>/);
});

await check("HTML 被转义，不会变成标签", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

await check("代码块里的 HTML 也被转义", () => {
  const html = renderMarkdown("```\n<img src=x onerror=alert(1)>\n```");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

await check("普通的链接保留下来", () => {
  const html = renderMarkdown("看 [文档](https://example.com/a)。");
  assert.match(html, /<a href="https:\/\/example\.com\/a" target="_blank" rel="noreferrer">文档<\/a>/);
});

await check("危险的链接不点得动", () => {
  const html = renderMarkdown("[点我](javascript:alert(1))");
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<a /);
});

await check("列表项里的行内标记", () => {
  const html = renderMarkdown("- 调用 `parse_document` 解析每一份文档");
  assert.match(html, /<li>调用 <code>parse_document<\/code> 解析每一份文档<\/li>/);
});

await check("转义函数处理引号", () => {
  assert.equal(escapeMarkdownHtml(`a "b" 'c' & d`), "a &quot;b&quot; &#39;c&#39; &amp; d");
});

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
