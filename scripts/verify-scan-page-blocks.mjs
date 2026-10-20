import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { createCrossDocAgent } from "../src/agent.ts";
import { LocalDatabase } from "../src/storage/database.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";

const PAGE_BOUNDS = [0, 0, 612, 792];
const TRANSCRIPT = [
  "第一条条款:交付期限为三十日。",
  "第二条条款:付款期限为四十五日。",
  "第三条条款:保密义务适用于双方。",
].join("\n");

function makeModel({ id = "vision-test", input = ["text", "image"] } = {}) {
  return {
    id,
    name: id,
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

function makeModels() {
  const model = makeModel();
  return {
    getModel: (provider, id) => (provider !== "test-provider" ? undefined : id === "vision-test" ? model : undefined),
    checkAuth: async (provider) => (provider === "test-provider" ? { type: "api_key" } : undefined),
  };
}

function scriptedStream(text) {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: "test-provider",
      model: "vision-test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  });
  return stream;
}

function fakeScannedDocument(id, title) {
  return {
    id,
    title,
    format: "pdf",
    pages: [{
      page: 1,
      text: "",
      blocks: [],
      pageBounds: PAGE_BOUNDS,
      classification: "scan-candidate",
      extractionMethod: "pending-vision",
    }],
    blocks: [],
    text: "",
    markdown: `# ${title}\n\n## Page 1\n\n`,
    warnings: ["Page 1 contains visual content without meaningful selectable text and needs vision reading."],
  };
}

function countFootnoteDefinitions(markdown) {
  return (markdown.match(/^\[\^src-\d+\]:/gm) ?? []).length;
}

async function main() {
  const storageRoot = await mkdtemp(join(tmpdir(), "crossdoc-scan-blocks-"));
  const sourcePath = join(storageRoot, "scanned.pdf");
  const libraryDirectory = join(storageRoot, "library");
  const database = new LocalDatabase(storageRoot);
  const selectedSource = { id: "scan-doc", title: "scanned.pdf", path: sourcePath, sourceName: "scanned.pdf" };

  try {
    await writeFile(sourcePath, "%PDF-scanned-placeholder");
    const savedDocuments = [];
    const agent = await createCrossDocAgent({
      documents: [selectedSource],
      models: makeModels(),
      streamFn: async () => scriptedStream("done"),
      mainProfile: { role: "main", provider: "test-provider", modelId: "vision-test", apiKey: "main-key" },
      visionProfile: { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "vision-key" },
      parseDocument: async (_path, options) => fakeScannedDocument(options.id, options.title),
      onDocumentUpdated: async (document, source) => {
        await saveLibraryDocument(document, source.path, source.sourceName ?? source.title, libraryDirectory, database);
        savedDocuments.push(structuredClone(document));
      },
    });

    const parseTool = agent.state.tools.find((tool) => tool.name === "parse_document");
    await parseTool.execute("parse", { documentId: selectedSource.id });

    const saveTool = agent.state.tools.find((tool) => tool.name === "save_scan_page_text");
    const saveResult = await saveTool.execute("save", { documentId: selectedSource.id, page: 1, text: TRANSCRIPT });
    assert.equal(saveResult.structuredContent.text, TRANSCRIPT, "the tool returns the stored transcript");

    const saved = savedDocuments.at(-1);
    const visionBlocks = saved.blocks.filter((block) => block.id.includes(":vision:"));

    // B1: the transcript becomes line-level blocks.
    assert.deepEqual(
      visionBlocks.map((block) => block.id),
      ["scan-doc:p1:vision:L1", "scan-doc:p1:vision:L2", "scan-doc:p1:vision:L3"],
      "vision text is stored as one block per transcript line",
    );
    assert.deepEqual(visionBlocks.map((block) => block.text), TRANSCRIPT.split("\n"));

    // B2: vision lines keep page-level provenance and never claim a text box.
    for (const block of visionBlocks) {
      assert.equal(block.source.type, "pdf");
      assert.equal(block.source.page, 1);
      assert.deepEqual(block.source.bbox, PAGE_BOUNDS, "a vision line points at the page, not at a fabricated box");
      assert.deepEqual(block.source.pageBounds, PAGE_BOUNDS);
    }

    // B3: one source note per page, reported without a bounding box.
    const markdown = saved.markdown;
    assert.equal(countFootnoteDefinitions(markdown), 1, "a scanned page is cited once, not once per line");
    assert.match(markdown, /\[\^src-1\]: scanned\.pdf, page 1$/m, "the source note reports the page without a fabricated box");
    assert.ok(!/page 1, bbox/.test(markdown), "a page-level citation never shows a text box");

    // B4: the artifact says how the page was read.
    assert.match(markdown, /This page was read by the vision model/);

    // B5: an identical retry reuses the stored text, a different one is refused.
    await saveTool.execute("retry", { documentId: selectedSource.id, page: 1, text: TRANSCRIPT });
    const afterRetry = savedDocuments.at(-1);
    assert.equal(afterRetry.blocks.length, visionBlocks.length, "an identical retry adds no block");
    assert.equal(afterRetry.pages[0].text, saved.pages[0].text, "an identical retry does not duplicate the transcript");
    await assert.rejects(
      saveTool.execute("conflict", { documentId: selectedSource.id, page: 1, text: "不同的转写内容。" }),
      /already has saved vision text that differs from this retry/,
    );

    // B6: retrieval reaches a single vision line with its context.
    const searchTool = agent.state.tools.find((tool) => tool.name === "search_document");
    const evidence = await searchTool.execute("search", { query: "付款期限", documentIds: [selectedSource.id] });
    assert.equal(evidence.structuredContent.excerpts[0].source.blockId, "scan-doc:p1:vision:L2");
    assert.match(evidence.structuredContent.excerpts[0].excerpt, /四十五日/);

    // B7: the archived artifacts record the reading method and the line blocks.
    const archivedJson = JSON.parse(await readFile(join(libraryDirectory, selectedSource.id, "document.json"), "utf8"));
    const archivedMarkdown = await readFile(join(libraryDirectory, selectedSource.id, "document.md"), "utf8");
    assert.equal(archivedJson.pages[0].extractionMethod, "vision-text");
    assert.deepEqual(
      archivedJson.blocks.map((block) => block.id),
      ["scan-doc:p1:vision:L1", "scan-doc:p1:vision:L2", "scan-doc:p1:vision:L3"],
    );
    assert.equal(countFootnoteDefinitions(archivedMarkdown), 1);
    assert.match(archivedMarkdown, /This page was read by the vision model/);

    database.close();
    console.log("Scan page block checks passed (line-level vision blocks, page-level provenance, one source note per page, idempotent retry, line retrieval).");
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

await main();
