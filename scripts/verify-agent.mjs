import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createCrossDocAgent, createCrossDocTools, CrossDocVisionModelConfigError, resolveVisionModel } from "../src/agent.ts";

function makeModel({ input = ["text", "image"] } = {}) {
  return {
    id: "vision-test",
    name: "Vision test model",
    api: "openai-responses",
    provider: "test-provider",
    baseUrl: "https://unused.invalid",
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 16_000,
    maxTokens: 1_000,
  };
}

function makeModels(model = makeModel(), auth = { type: "api_key" }) {
  return {
    getModel: (provider, id) => provider === "test-provider" && id === "vision-test" ? model : undefined,
    checkAuth: async (provider) => provider === "test-provider" ? auth : undefined,
  };
}

function fakeParsedDocument(id, title) {
  return {
    id,
    title,
    format: "pdf",
    pages: [{
      page: 1,
      text: "",
      blocks: [],
      pageBounds: [0, 0, 612, 792],
      classification: "scan-candidate",
      extractionMethod: "pending-vision",
    }],
    blocks: [],
    text: "",
    markdown: `# ${title}\n\n## Page 1\n\n> needs vision reading\n`,
    warnings: ["Page 1 contains visual content without meaningful selectable text and needs vision reading."],
  };
}

function scriptedStream(message) {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  return stream;
}

function message(content, stopReason) {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "test-provider",
    model: "vision-test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

function toolCall(name, arguments_) {
  return { type: "toolCall", id: `call-${name}`, name, arguments: arguments_ };
}

async function main() {
  await assert.rejects(
    resolveVisionModel(makeModels(), ""),
    (error) => error instanceof CrossDocVisionModelConfigError && /CROSSDOC_VISION_MODEL is required/.test(error.message),
  );
  await assert.rejects(resolveVisionModel(makeModels(), "invalid"), /provider\/model-id/);
  await assert.rejects(resolveVisionModel(makeModels(), "missing/model"), /not in Pi AI's built-in catalog/);
  await assert.rejects(resolveVisionModel(makeModels(makeModel({ input: ["text"] })), "test-provider/vision-test"), /does not support image input/);
  await assert.rejects(resolveVisionModel(makeModels(makeModel(), null), "test-provider/vision-test"), /No credentials are configured/);
  assert.equal((await resolveVisionModel(makeModels(), "test-provider/vision-test")).id, "vision-test");

  const savedUpdates = [];
  const selectedSource = { id: "opaque-pdf-id", title: "scan.pdf", path: "/server/chosen/scan.pdf" };
  const calls = [
    toolCall("inspect_document", { documentId: selectedSource.id }),
    toolCall("load_document_skill", { skill: "pdf-reading" }),
    toolCall("parse_document", { documentId: selectedSource.id }),
    toolCall("render_scan_page", { documentId: selectedSource.id, page: 1 }),
    toolCall("save_scan_page_text", { documentId: selectedSource.id, page: 1, text: "扫描页识别出的合同条款。" }),
    toolCall("load_document_skill", { skill: "document-overview" }),
  ];
  const usedTools = [];
  let sawImageResult = false;
  let requestIndex = 0;
  const streamFn = async (_model, context) => {
    if (context.messages.some((item) => item.role === "toolResult" && item.content?.some((part) => part.type === "image"))) {
      sawImageResult = true;
    }
    const next = calls[requestIndex++];
    if (!next) return scriptedStream(message([{ type: "text", text: "概述：[第 1 页](#page=1)" }], "stop"));
    return scriptedStream(message([next], "toolUse"));
  };
  const agent = await createCrossDocAgent({
    documents: [selectedSource],
    models: makeModels(),
    streamFn,
    visionModel: "test-provider/vision-test",
    parseDocument: async (_path, options) => fakeParsedDocument(options.id, options.title),
    renderScanPage: async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 100, height: 140 }),
    onDocumentUpdated: async (document, source) => savedUpdates.push({ document, source }),
  });
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") usedTools.push(event.toolName);
  });
  await agent.prompt("读取这份 PDF 并概述内容");
  assert.equal(sawImageResult, true, "the rendered scan page must return image content to the next model request");
  assert.deepEqual(usedTools, ["inspect_document", "load_document_skill", "parse_document", "render_scan_page", "save_scan_page_text", "load_document_skill"]);
  assert.equal(usedTools.some((name) => name === "compare_claims" || name === "verify_conflicts" || name === "report_conflicts"), false);
  assert.equal(savedUpdates.length, 2, "parse and scan-text mutations should each invoke the persistence callback");
  const saved = savedUpdates.at(-1).document;
  assert.equal(saved.blocks[0].id, "opaque-pdf-id:p1:vision");
  assert.equal(saved.blocks[0].source.page, 1);
  assert.equal(saved.pages[0].extractionMethod, "vision-text");
  assert.match(saved.markdown, /扫描页识别出的合同条款/);
  assert.deepEqual(saved.warnings, []);
  assert.match(agent.state.messages.map((item) => JSON.stringify(item)).join("\n"), /Saved page 1 text/);

  const scopedTools = createCrossDocTools({ documents: [selectedSource] });
  const inspect = scopedTools.find((tool) => tool.name === "inspect_document");
  await assert.rejects(inspect.execute("bad-id", { documentId: "outside-scope" }), /not available in this request/);
  const render = scopedTools.find((tool) => tool.name === "render_scan_page");
  await assert.rejects(render.execute("unparsed", { documentId: selectedSource.id, page: 1 }), /has not been parsed/);

  const budgetTools = createCrossDocTools({
    documents: [
      { id: "budget-a", title: "a.pdf", path: "/virtual/a.pdf" },
      { id: "budget-b", title: "b.pdf", path: "/virtual/b.pdf" },
    ],
    parseDocument: async (_path, options) => {
      const document = fakeParsedDocument(options.id, options.title);
      const text = `${"可引用的正文内容。".repeat(10_000)} 尾部专属关键字`;
      const block = {
        id: `${options.id}:p1:b1`,
        kind: "text",
        text,
        source: { type: "pdf", page: 1, bbox: [0, 0, 612, 792], pageBounds: [0, 0, 612, 792] },
        start: 0,
        end: text.length,
      };
      document.pages[0].text = text;
      document.pages[0].blocks = [block];
      document.blocks = [block];
      document.text = text;
      return document;
    },
  });
  const budgetParse = budgetTools.find((tool) => tool.name === "parse_document");
  for (const documentId of ["budget-a", "budget-b"]) {
    const parsedResult = await budgetParse.execute(`parse-${documentId}`, { documentId });
    assert.equal(parsedResult.details.contentTruncated, true);
    assert.ok(parsedResult.structuredContent.normalizedContent.length <= 40_000);
    assert.match(parsedResult.content[0].text, /Page 1/);
  }
  const budgetSearch = budgetTools.find((tool) => tool.name === "search_document");
  const tailEvidence = await budgetSearch.execute("search-tail", { query: "尾部专属关键字", documentIds: ["budget-a"] });
  assert.equal(tailEvidence.structuredContent.status, "matches", "retrieval must search the full ParsedDocument beyond the model output budget");
  assert.equal(tailEvidence.structuredContent.excerpts[0].source.location.page, 1);

  console.log("Agent and scoped document tool checks passed.");
}

await main();
