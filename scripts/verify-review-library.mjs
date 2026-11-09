/**
 * Checks the endpoints the review desk grew: starting a review from the
 * library, listing the reviews that were run before, opening one of them
 * again, and testing a model connection without saving it.
 *
 * The review itself is driven by a scripted model catalog, so the run is
 * deterministic and needs no network.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { createWebApp, listenWebApp } from "../src/server.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";

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

const quoteA = "The Client shall pay all undisputed invoices within 45 days of receipt.";
const quoteB = "The Client shall pay all undisputed invoices within 90 days of receipt.";

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

/** A scripted run: parse both documents, align one key, judge it, report it. */
function scriptedCalls(documentA, documentB) {
  return [
    toolCall("parse_document", { documentId: documentA }),
    toolCall("parse_document", { documentId: documentB }),
    toolCall("load_document_skill", { skill: "key-data-alignment" }),
    toolCall("load_document_skill", { skill: "conflict-adjudication" }),
    toolCall("align_key_data", {
      items: [
        { documentId: documentA, key: "payment_term", value: "45 days", quote: quoteA, page: 1 },
        { documentId: documentB, key: "payment_term", value: "90 days", quote: quoteB, page: 1 },
      ],
    }),
    toolCall("verify_conflicts", {
      judgments: [{ candidateId: "pair-1", conflict: true, severity: "high", confidence: 0.94, summary: "付款期限不一致", rationale: "两份协议约定的付款期限不同。" }],
    }),
    toolCall("report_conflicts", {}),
  ];
}

async function readNdjson(response) {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const workspace = await mkdtemp(join(tmpdir(), "crossdoc-review-library-"));
const libraryDirectory = join(workspace, "library");
const dataDirectory = workspace;
const reviewDirectory = join(workspace, "reviews");
const uploadDirectory = join(workspace, "uploads");

const models = makeModels();
models.streamSimple = () => scriptedStream([{ type: "text", text: "审查完成。" }], "stop");

const app = createWebApp({
  publicDirectory: "public",
  libraryDirectory,
  dataDirectory,
  reviewDirectory,
  uploadDirectory,
  models,
});
const database = app.locals.database;
database.saveModelProfile({ role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" });
database.saveModelProfile({ role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "scripted-key" });

// Two documents are put in the library the same way the upload route does it.
const documentA = "library-doc-a";
const documentB = "library-doc-b";
for (const [id, title, text] of [[documentA, "contract-a.pdf", quoteA], [documentB, "contract-b.pdf", quoteB]]) {
  const sourcePath = join(workspace, `${id}.pdf`);
  await writeFile(sourcePath, pdfBytes(text));
  await saveLibraryDocument(
    {
      id,
      title,
      format: "pdf",
      pages: [{ page: 1, text, blocks: [], classification: "text-native", extractionMethod: "native-text" }],
      blocks: [],
      text,
      markdown: `# ${title}\n\n${text}\n`,
      warnings: [],
    },
    sourcePath,
    title,
    libraryDirectory,
    database,
  );
}

const server = listenWebApp(app, 0);
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

try {
  await check("L1 文档列表里选两份文档就能发起审查", async () => {
    let index = 0;
    models.streamSimple = () => {
      const call = scriptedCalls(documentA, documentB)[index++];
      if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
      return scriptedStream([call], "toolUse");
    };

    const response = await fetch(`${base}/api/review/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [documentA, documentB] }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /ndjson/);

    const events = await readNdjson(response);
    const result = events.at(-1);
    assert.equal(result.type, "result", `审查没有跑完：${JSON.stringify(events)}`);
    assert.equal(result.documents.length, 2);
    assert.equal(result.claimCount, 2);
    assert.equal(result.conflictCount, 1);
    assert.equal(result.verifiedConflictCount, 1);
    assert.ok(events.some((event) => event.type === "progress"), "审查过程有进度事件");
  });

  await check("L2 审查记录列表能列出刚跑完的那次", async () => {
    const response = await fetch(`${base}/api/reviews`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.reviews.length, 1);
    const [entry] = data.reviews;
    assert.match(entry.id, /^[A-Za-z0-9_-]+$/);
    assert.ok(entry.createdAt, "有创建时间");
    assert.deepEqual([...entry.titles].sort(), ["contract-a.pdf", "contract-b.pdf"]);
    assert.equal(entry.documentCount, 2);
    assert.equal(entry.claimCount, 2);
    assert.equal(entry.conflictCount, 1);
    assert.equal(entry.verifiedConflictCount, 1);
  });

  await check("L3 打开历史审查拿到的内容和当时跑出来的一样", async () => {
    const list = await (await fetch(`${base}/api/reviews`)).json();
    const [entry] = list.reviews;
    const response = await fetch(`${base}/api/reviews/${entry.id}`);
    assert.equal(response.status, 200);
    const stored = await response.json();
    assert.equal(stored.type, "result");
    assert.equal(stored.reviewId, entry.id);
    assert.equal(stored.documents.length, 2);
    assert.equal(stored.claimCount, 2);
    assert.equal(stored.conflictCount, 1);
    assert.equal(stored.verifiedConflictCount, 1);
    assert.equal(stored.judgeSource, "model");
    assert.ok(Array.isArray(stored.stages) && stored.stages.length > 0, "记录了审查走过的工具");
    assert.equal(stored.conflicts.length, 1);
    assert.ok(stored.reportMarkdown.includes("#"), "有 Markdown 报告");
  });

  await check("L4 历史审查找不到时不报错", async () => {
    const missing = await fetch(`${base}/api/reviews/not-a-real-review`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${base}/api/reviews/..%2F..%2Fetc%2Fpasswd`);
    assert.ok(traversal.status === 400 || traversal.status === 404, `越界 id 被挡住，实际 ${traversal.status}`);
  });

  await check("L5 从文档列表发起审查时参数不合法就拒绝", async () => {
    const empty = await fetch(`${base}/api/review/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [] }),
    });
    assert.equal(empty.status, 400);
    const unknown = await fetch(`${base}/api/review/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [documentA, "no-such-document"] }),
    });
    assert.equal(unknown.status, 404);
  });

  await check("M1 连接测试的入参不对就拒绝", async () => {
    const noRole = await fetch(`${base}/api/settings/models/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "m" }),
    });
    assert.equal(noRole.status, 400);
    const badProtocol = await fetch(`${base}/api/settings/models/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "main", protocol: "smoke-signals", modelId: "m" }),
    });
    assert.equal(badProtocol.status, 400);
    const noModel = await fetch(`${base}/api/settings/models/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "main", protocol: "openai-completions", baseUrl: "http://127.0.0.1:1/v1" }),
    });
    assert.equal(noModel.status, 400);
  });

  await check("M2 连接测试打到一个真的端点就能通", async () => {
    const upstream = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        assert.match(request.url ?? "", /\/chat\/completions$/);
        const payload = JSON.parse(body);
        const last = payload.messages.at(-1).content;
        const text = Array.isArray(last) ? last.map((part) => part.text ?? "").join(" ") : String(last);
        assert.equal(text, "Reply with the single word: ok");
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(
          [
            'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
        );
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const port = upstream.address().port;

    try {
      const response = await fetch(`${base}/api/settings/models/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "main",
          protocol: "openai-completions",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          modelId: "fake-model",
          apiKey: "scripted-key",
        }),
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.ok, true);
      assert.equal(data.reply, "ok");
      assert.ok(typeof data.latencyMs === "number" && data.latencyMs >= 0);
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  await check("M3 连接测试不会改掉已经保存的模型配置", async () => {
    const before = database.getModelProfile("main");
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const port = upstream.address().port;
    try {
      await fetch(`${base}/api/settings/models/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "main",
          protocol: "openai-completions",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          modelId: "another-model",
          apiKey: "another-scripted-key",
        }),
      });
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
    const after = database.getModelProfile("main");
    assert.deepEqual(after, before, "存档的 profile 没有被测试改写");
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
