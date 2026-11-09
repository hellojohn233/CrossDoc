/**
 * Checks how the library treats content that arrives twice.
 *
 * The library keeps every upload — a document's identity is its content, but
 * an upload is a fact worth keeping — and it marks the ones that share
 * content so the list can show three documents instead of thirty rows.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { createCrossDocAgent } from "../src/agent.ts";
import { createWebApp, listenWebApp } from "../src/server.ts";
import { renderLibraryGroups } from "../public/js/library-groups.js";

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

function pdfBytes(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

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
    getModel: (provider, id) =>
      provider === "test-provider" ? (id === "main-text" ? main : id === "vision-test" ? vision : undefined) : undefined,
    checkAuth: async (provider) => (provider === "test-provider" ? { type: "api_key" } : undefined),
  };
}

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

const workspace = await mkdtemp(join(tmpdir(), "crossdoc-library-identity-"));
const libraryDirectory = join(workspace, "library");
const dataDirectory = workspace;
const uploadDirectory = join(workspace, "uploads");
// 审查产物不能落到真实的 .crossdoc/reviews 里去。
const reviewDirectory = join(workspace, "reviews");

const models = makeModels();
const app = createWebApp({
  publicDirectory: "public",
  libraryDirectory,
  dataDirectory,
  uploadDirectory,
  reviewDirectory,
  models,
  agentFactory: async (options) => {
    const ids = options.documents.map((document) => document.id);
    let index = 0;
    return createCrossDocAgent({
      ...options,
      models,
      streamFn: async () => {
        const documentId = ids[index++];
        if (documentId) return scriptedStream([toolCall("parse_document", { documentId })], "toolUse");
        return scriptedStream([{ type: "text", text: "读完了。" }], "stop");
      },
    });
  },
});
const database = app.locals.database;
database.saveModelProfile({ role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" });
database.saveModelProfile({ role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "scripted-key" });

const server = listenWebApp(app, 0);
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

async function upload(files) {
  const form = new FormData();
  for (const { name, content } of files) {
    form.append("documents[]", new Blob([content], { type: "application/pdf" }), name);
  }
  const response = await fetch(`${base}/api/read`, { method: "POST", body: form });
  assert.equal(response.status, 202, `上传被拒绝：${response.status}`);
  const session = await response.json();
  await readUntilDone(`${base}/api/read/${session.sessionId}/events`);
  return session;
}

/** Reads the session's event stream until the run is over. */
async function readUntilDone(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes("event: done\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

async function library() {
  const response = await fetch(`${base}/api/library`);
  const data = await response.json();
  return data.documents ?? [];
}

/** Waits until the library holds the expected number of documents. */
async function waitForLibrary(count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const documents = await library();
    if (documents.length >= count) return documents;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return library();
}

/** Groups the library the way the list does: by content. */
function groupsByContent(documents) {
  const groups = new Map();
  for (const document of documents) {
    const key = document.sha256 || `id:${document.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(document);
  }
  return [...groups.values()];
}

try {
  const firstContent = pdfBytes("Library identity check");

  await check("D1 同一份文件上传两次，两次归档都留下", async () => {
    const first = await upload([{ name: "agreement.pdf", content: firstContent }]);
    await waitForLibrary(1);
    const second = await upload([{ name: "agreement-again.pdf", content: firstContent }]);
    await waitForLibrary(2);

    const documents = await library();
    assert.equal(documents.length, 2, "两次上传都留下了归档");
    assert.notEqual(documents[0].id, documents[1].id, "两次归档是不同的条目");
    assert.equal(groupsByContent(documents).length, 1, "但它们是同一份内容");
  });

  await check("D2 内容相同的文档共享一个内容哈希", async () => {
    const documents = await library();
    assert.equal(documents[0].sha256, documents[1].sha256);
    assert.equal(documents[0].sha256.length, 64);
  });

  await check("D3 上传时告诉用户这份内容已经在库里", async () => {
    const session = await upload([{ name: "agreement-third.pdf", content: firstContent }]);
    const marked = session.documents.find((document) => document.duplicateOf);
    assert.ok(marked, "上传的那一份被标记了");
    assert.equal(marked.duplicateOf.title, "agreement.pdf", "指向最早归档的那一份");
    assert.ok(marked.duplicateOf.uploadedAt, "带上了最早归档的时间");
  });

  await check("D4 一次选两份相同文件，只算一份，另一份可见失败", async () => {
    const session = await upload([
      { name: "twin-one.pdf", content: firstContent },
      { name: "twin-two.pdf", content: firstContent },
    ]);
    assert.equal(session.documents.length, 2, "两个文件都在会话里可见");
    const failed = session.documents.filter((document) => document.state === "failed");
    assert.equal(failed.length, 1, "其中一份被标为失败");
    assert.match(failed[0].error ?? "", /相同/, "失败原因说清楚了");
  });

  await check("D5 内容不同的文件各自成条", async () => {
    await upload([{ name: "other.pdf", content: pdfBytes("A different agreement") }]);
    const documents = await waitForLibrary(4);
    assert.equal(groupsByContent(documents).length, 2, "两种内容分成两组");
  });

  await check("D6 按内容可以找到归档的文档", async () => {
    const documents = await library();
    const found = database.findDocumentBySha256(documents[0].sha256);
    assert.equal(found?.id, documents[0].id, "内容哈希能找回归档的文档");
    assert.equal(database.findDocumentBySha256(""), undefined, "空哈希不匹配任何文档");
  });

  await check("D7 从库里再审一次，首次归档时间不动，最近使用时间刷新", async () => {
    const documents = await library();
    const target = documents[0];
    const before = database.getDocument(target.id);
    assert.ok(before, "这条归档存在");

    const response = await fetch(`${base}/api/review/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [target.id] }),
    });
    assert.equal(response.status, 200);
    await response.text();

    const after = database.getDocument(target.id);
    assert.equal(after.uploadedAt, before.uploadedAt, "首次归档时间不变");
    assert.notEqual(after.lastUsedAt, before.lastUsedAt, "最近使用时间刷新了");
    assert.ok(Date.parse(after.lastUsedAt) > Date.parse(before.lastUsedAt));
  });

  await check("D8 旧数据库升级后补上最近使用时间", async () => {
    const migrated = database.listDocuments();
    assert.ok(migrated.length > 0);
    for (const document of migrated) {
      assert.ok(document.lastUsedAt, "每条记录都有最近使用时间");
    }
  });

  await check("D9 列表按内容折叠，每份内容只占一行", async () => {
    const documents = await library();
    const html = renderLibraryGroups(documents, { picked: () => false });
    const groups = html.match(/class="library-group"/g) ?? [];
    assert.equal(groups.length, 1, "只有有副本的那一组带折叠区");
    assert.equal((html.match(/data-review-pick/g) ?? []).length, 2, "两份内容各占一行");
    assert.match(html, /另有 \d+ 份相同内容/);
    assert.match(html, /\d+ 组内容相同，共 \d+ 份归档/);
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  for (const entry of failed) console.error(`\n${entry.name}\n${entry.error?.stack ?? entry.error}`);
  process.exit(1);
}
