import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createCrossDocAgent, createCrossDocTools, CrossDocVisionModelConfigError, resolveVisionModel } from "../src/agent.ts";
import { LocalDatabase } from "../src/storage/database.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";

function makeModel({ id = "vision-test", input = ["text", "image"] } = {}) {
  return {
    id,
    name: id === "main-text" ? "Text-only main model" : "Vision test model",
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
    getModel: (provider, id) => provider !== "test-provider" ? undefined : id === "vision-test" ? model : id === "main-text" ? makeModel({ id, input: ["text"] }) : undefined,
    checkAuth: async (provider) => provider === "test-provider" ? auth : undefined,
  };
}

function fakeParsedDocument(id, title, withNativeText = false) {
  const nativeText = withNativeText ? "表格编号 A-19" : "";
  const nativeBlock = withNativeText ? {
    id: `${id}:p1:b1`,
    kind: "text",
    text: nativeText,
    source: { type: "pdf", page: 1, bbox: [25, 600, 98, 612], pageBounds: [0, 0, 612, 792] },
    start: 0,
    end: nativeText.length,
  } : undefined;
  return {
    id,
    title,
    format: "pdf",
    pages: [{
      page: 1,
      text: nativeText,
      blocks: nativeBlock ? [nativeBlock] : [],
      pageBounds: [0, 0, 612, 792],
      classification: "scan-candidate",
      extractionMethod: "pending-vision",
    }],
    blocks: nativeBlock ? [nativeBlock] : [],
    text: nativeText,
    markdown: `# ${title}\n\n## Page 1\n\n${nativeText}\n`,
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
  const storageRoot = await mkdtemp(join(tmpdir(), "crossdoc-agent-scan-"));
  const sourcePath = join(storageRoot, "scan.pdf");
  const libraryDirectory = join(storageRoot, "library");
  const scanDatabase = new LocalDatabase(storageRoot);
  await writeFile(sourcePath, "%PDF-scripted-scan");
  await assert.rejects(
    resolveVisionModel(makeModels(), ""),
    (error) => error instanceof CrossDocVisionModelConfigError && /Configure the vision model/.test(error.message),
  );
  await assert.rejects(resolveVisionModel(makeModels(), "invalid"), /provider\/model-id/);
  await assert.rejects(resolveVisionModel(makeModels(), "missing/model"), /not in Pi AI's model catalog/);
  await assert.rejects(resolveVisionModel(makeModels(makeModel({ input: ["text"] })), "test-provider/vision-test"), /does not support image input/);
  await assert.rejects(resolveVisionModel(makeModels(makeModel(), null), "test-provider/vision-test"), /No API key is saved/);
  assert.equal((await resolveVisionModel(makeModels(), "test-provider/vision-test")).id, "vision-test");

  const requestModels = makeModels();
  let observedMainRequest;
  requestModels.streamSimple = (selectedModel, _context, options) => {
    observedMainRequest = { modelId: selectedModel.id, apiKey: options.apiKey };
    return scriptedStream(message([{ type: "text", text: "ready" }], "stop"));
  };
  const profileAgent = await createCrossDocAgent({
    documents: [],
    models: requestModels,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "main-profile-key" },
    visionProfile: { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "vision-profile-key" },
  });
  await profileAgent.prompt("ready?");
  assert.deepEqual(observedMainRequest, { modelId: "main-text", apiKey: "main-profile-key" }, "main profile credentials are supplied only to its stream request");

  const savedUpdates = [];
  const selectedSource = { id: "opaque-pdf-id", title: "scan.pdf", path: sourcePath };
  const visionTranscript = "  扫描页识别出的合同条款。\n";
  const calls = [
    toolCall("inspect_document", { documentId: selectedSource.id }),
    toolCall("load_document_skill", { skill: "pdf-reading" }),
    toolCall("parse_document", { documentId: selectedSource.id }),
    toolCall("render_scan_page", { documentId: selectedSource.id, page: 1 }),
    toolCall("load_document_skill", { skill: "document-overview" }),
  ];
  const usedTools = [];
  let sawImageInMain = false;
  let visionCallCount = 0;
  let requestIndex = 0;
  const streamFn = async (_model, context) => {
    assert.equal(_model.id, "main-text", "a text-only model is used for orchestration");
    if (context.messages.some((item) => item.role === "toolResult" && item.content?.some((part) => part.type === "image"))) sawImageInMain = true;
    const next = calls[requestIndex++];
    if (!next) return scriptedStream(message([{ type: "text", text: "概述：[第 1 页](#page=1)" }], "stop"));
    return scriptedStream(message([next], "toolUse"));
  };
  const agent = await createCrossDocAgent({
    documents: [selectedSource],
    models: makeModels(),
    streamFn,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "main-key" },
    visionProfile: { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "vision-key" },
    visionModel: "test-provider/vision-test",
    visionCompleteSimple: async (_model, context, options) => {
      visionCallCount += 1;
      assert.equal(options.apiKey, "vision-key");
      const imageParts = context.messages.flatMap((item) => item.content).filter((part) => part.type === "image");
      assert.equal(imageParts.length, 1, "vision request receives exactly one rendered page");
      return message([{ type: "text", text: visionTranscript }], "stop");
    },
    parseDocument: async (_path, options) => fakeParsedDocument(options.id, options.title, true),
    renderScanPage: async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 100, height: 140 }),
    onDocumentUpdated: async (document, source) => {
      const entry = await saveLibraryDocument(document, source.path, source.sourceName ?? source.title, libraryDirectory, scanDatabase);
      savedUpdates.push({ document: structuredClone(document), source, entry });
    },
  });
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") usedTools.push(event.toolName);
  });
  await agent.prompt("读取这份 PDF 并概述内容");
  assert.equal(sawImageInMain, false, "the main model must never receive the scan image");
  assert.equal(visionCallCount, 1, "each scan page is transcribed by the separate vision profile");
  assert.deepEqual(usedTools, ["inspect_document", "load_document_skill", "parse_document", "render_scan_page", "load_document_skill"]);
  assert.equal(usedTools.some((name) => name === "compare_claims" || name === "verify_conflicts" || name === "report_conflicts"), false);
  assert.equal(savedUpdates.length, 2, "one vision tool invocation must persist the recognized transcript through the archive callback");
  const saved = savedUpdates.at(-1).document;
  assert.deepEqual(saved.blocks.map((block) => block.id), ["opaque-pdf-id:p1:b1", "opaque-pdf-id:p1:vision"]);
  assert.deepEqual(saved.blocks[0].source.bbox, [25, 600, 98, 612], "native block coordinates must be retained");
  assert.equal(saved.blocks[1].source.page, 1);
  assert.equal(saved.blocks[1].text, visionTranscript, "the scan tool stores the exact vision response without main-model relay or trimming");
  assert.equal(saved.pages[0].extractionMethod, "vision-text");
  assert.match(saved.pages[0].text, /表格编号 A-19[\s\S]*扫描页识别出的合同条款/);
  assert.match(saved.text, /表格编号 A-19[\s\S]*扫描页识别出的合同条款/);
  assert.match(saved.markdown, /表格编号 A-19[\s\S]*扫描页识别出的合同条款/);
  assert.match(saved.markdown, /扫描页识别出的合同条款/);
  assert.deepEqual(saved.warnings, []);
  assert.match(agent.state.messages.map((item) => JSON.stringify(item)).join("\n"), /Saved page 1 text/);
  const archivedJson = JSON.parse(await readFile(join(libraryDirectory, selectedSource.id, "document.json"), "utf8"));
  const archivedMarkdown = await readFile(join(libraryDirectory, selectedSource.id, "document.md"), "utf8");
  assert.equal(archivedJson.blocks.find((block) => block.id.endsWith(":vision")).text, visionTranscript);
  assert.match(archivedMarkdown, /扫描页识别出的合同条款/);
  assert.ok(savedUpdates.at(-1).entry.documentJsonPath?.endsWith("document.json"));

  const saveScanText = agent.state.tools.find((tool) => tool.name === "save_scan_page_text");
  await saveScanText.execute("retry-save", { documentId: selectedSource.id, page: 1, text: visionTranscript });
  assert.equal(savedUpdates.length, 3, "an identical retry may persist again without adding a duplicate block");
  assert.equal(savedUpdates.at(-1).document.blocks.length, 2);
  const scopedSearch = agent.state.tools.find((tool) => tool.name === "search_document");
  const nativeEvidence = await scopedSearch.execute("search-native", { query: "表格编号", documentIds: [selectedSource.id] });
  const visionEvidence = await scopedSearch.execute("search-vision", { query: "合同条款", documentIds: [selectedSource.id] });
  assert.equal(nativeEvidence.structuredContent.excerpts[0].source.blockId, "opaque-pdf-id:p1:b1");
  assert.equal(visionEvidence.structuredContent.excerpts[0].source.blockId, "opaque-pdf-id:p1:vision");
  scanDatabase.close();
  await rm(storageRoot, { recursive: true, force: true });

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
