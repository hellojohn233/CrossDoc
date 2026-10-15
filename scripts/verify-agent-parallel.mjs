import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createCrossDocAgent } from "../src/agent.ts";
import { parseDoc } from "../src/tools/parse.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function makeModel() {
  return {
    id: "vision-test",
    name: "Vision test model",
    api: "openai-responses",
    provider: "test-provider",
    baseUrl: "https://unused.invalid",
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 16_000,
    maxTokens: 1_000,
  };
}

function makeModels() {
  return {
    getModel: (provider, id) => provider === "test-provider" && id === "vision-test" ? makeModel() : undefined,
    checkAuth: async (provider) => provider === "test-provider" ? { type: "api_key" } : undefined,
  };
}

function makeAssistantMessage(content, stopReason) {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "test-provider",
    model: "vision-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamMessage(message) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
  return stream;
}

function pdfBytes(text) {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
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

async function main() {
  const root = await mkdtemp(join(tmpdir(), "crossdoc-agent-parallel-"));
  const uploadDir = join(root, "uploads");
  const libraryDir = join(root, "library");
  await mkdir(uploadDir, { recursive: true });

  const selected = [
    { id: "doc-slow", title: "slow.pdf", content: "Slow source evidence 1101", delayMs: 70 },
    { id: "doc-fast", title: "fast.pdf", content: "Fast source evidence 2202", delayMs: 5 },
    { id: "doc-bad", title: "malformed.pdf", content: null, delayMs: 0 },
    { id: "doc-mid", title: "mid.pdf", content: "Middle source evidence 3303", delayMs: 35 },
    { id: "doc-last", title: "last.pdf", content: "Last source evidence 4404", delayMs: 1 },
  ];
  for (const item of selected) {
    item.path = join(uploadDir, item.title);
    await writeFile(item.path, item.content ? pdfBytes(item.content) : "not a PDF");
  }

  let activeImports = 0;
  let maxActiveImports = 0;
  let overlapObserved = false;
  const started = [];
  const completed = [];
  const archived = new Map();
  const toolResultOrder = [];
  let requestCount = 0;

  const streamFn = async (_model, context) => {
    requestCount += 1;
    if (requestCount === 1) {
      return streamMessage(makeAssistantMessage(selected.map((item) => ({
        type: "toolCall",
        id: `parse-${item.id}`,
        name: "parse_document",
        arguments: { documentId: item.id },
      })), "toolUse"));
    }
    toolResultOrder.push(...context.messages
      .filter((message) => message.role === "toolResult" && message.toolName === "parse_document")
      .map((message) => message.toolCallId));
    return streamMessage(makeAssistantMessage([{ type: "text", text: "Read complete with one file error." }], "stop"));
  };

  try {
    const agent = await createCrossDocAgent({
      documents: selected.map(({ id, title, path }) => ({ id, title, path, sourceName: title })),
      models: makeModels(),
      streamFn,
      mainProfile: { role: "main", provider: "test-provider", modelId: "vision-test", apiKey: "main-key" },
      visionProfile: { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "vision-key" },
      visionModel: "test-provider/vision-test",
      parseDocument: async (path, parseOptions) => {
        const item = selected.find((candidate) => candidate.path === path);
        assert.ok(item);
        activeImports += 1;
        maxActiveImports = Math.max(maxActiveImports, activeImports);
        overlapObserved ||= activeImports >= 2;
        started.push(item.id);
        try {
          const document = await parseDoc(path, parseOptions);
          await delay(item.delayMs);
          return document;
        } catch (error) {
          activeImports -= 1;
          completed.push(item.id);
          throw error;
        }
      },
      onDocumentUpdated: async (document, source) => {
        try {
          await saveLibraryDocument(document, source.path, source.sourceName, libraryDir);
          archived.set(source.id, document);
          completed.push(source.id);
        } finally {
          activeImports -= 1;
        }
      },
    });

    const toolErrors = [];
    const resultDetails = new Map();
    const turnResultOrders = [];
    agent.subscribe((event) => {
      if (event.type === "tool_execution_end" && event.toolName === "parse_document") {
        if (event.isError) toolErrors.push(event.result.details);
        resultDetails.set(event.toolCallId, event.result.structuredContent);
      }
      if (event.type === "turn_end" && event.message.content.some((part) => part.type === "toolCall")) {
        turnResultOrders.push(event.toolResults.filter((item) => item.toolName === "parse_document").map((item) => item.toolCallId));
      }
    });

    await agent.prompt("Parse all selected PDF files");

    assert.ok(overlapObserved, "independent real PDF parser calls must overlap");
    assert.ok(maxActiveImports >= 2, "at least two parses should be active at once");
    assert.ok(maxActiveImports <= 3, `active parse/persistence work exceeded cap: ${maxActiveImports}`);
    assert.equal(activeImports, 0, "all parse and persistence slots should be released when the request completes");
    assert.deepEqual(started, selected.map((item) => item.id), "Pi should launch the tool batch in selected-file order");
    assert.notDeepEqual(completed, selected.map((item) => item.id), "completion order should differ from selection order");

    const expectedToolCallOrder = selected.map((item) => `parse-${item.id}`);
    assert.deepEqual(turnResultOrders[0], expectedToolCallOrder, "Pi must emit batched tool results in assistant source order");
    assert.deepEqual(toolResultOrder, expectedToolCallOrder, "the next model turn must receive results in selection order");
    assert.equal(toolErrors.length, 1);
    assert.equal(toolErrors[0].documentId, "doc-bad");
    assert.equal(toolErrors[0].status, "error");

    const successful = selected.filter((item) => item.content !== null);
    assert.deepEqual([...archived.keys()].sort(), successful.map((item) => item.id).sort());
    for (const item of successful) {
      const result = resultDetails.get(`parse-${item.id}`);
      assert.equal(result.documentId, item.id);
      assert.equal(result.status, "parsed");
      assert.match(result.normalizedContent, new RegExp(`${item.id}:p1:b1; page 1`));
      const artifactDir = join(libraryDir, item.id);
      const markdown = await readFile(join(artifactDir, "document.md"), "utf8");
      assert.match(markdown, new RegExp(item.content));
      assert.match(markdown, /page 1, bbox/);
      assert.equal((await readFile(join(artifactDir, "source.pdf"))).subarray(0, 8).toString("ascii"), "%PDF-1.4");
      assert.equal(JSON.parse(await readFile(join(artifactDir, "metadata.json"), "utf8")).id, item.id);
    }
    await assert.rejects(readFile(join(libraryDir, "doc-bad", "metadata.json")));
    console.log("Agent parallel parsing checks passed (overlap, cap=3, selection-order results, partial archive success).");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
