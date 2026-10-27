import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createBuiltinModels, createCrossDocAgent, CrossDocVisionModelConfigError, resolveModelProfile } from "../src/agent.ts";
import { createWebApp, isUploadSelectionWithinLimit, listenWebApp } from "../src/server.ts";
import { parseDoc } from "../src/tools/parse.ts";

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

function model() {
  return {
    id: "scripted-vision", name: "Scripted vision", api: "openai-responses", provider: "test-provider",
    baseUrl: "https://unused.invalid", input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false, contextWindow: 16_000, maxTokens: 1_000,
  };
}

function models() {
  return {
    getModel: (provider, id) => provider === "test-provider" && id === "scripted-vision" ? model() : undefined,
    checkAuth: async (provider) => provider === "test-provider" ? { type: "api_key" } : undefined,
  };
}

function assistant(content, stopReason) {
  return {
    role: "assistant", content, api: "openai-responses", provider: "test-provider", model: "scripted-vision",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: Date.now(),
  };
}

function scriptedMessage(message) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
  return stream;
}

function toolCall(name, arguments_) {
  return { type: "toolCall", id: `web-${name}`, name, arguments: arguments_ };
}

function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

async function verifyCustomPiProtocols() {
  const collection = createBuiltinModels();
  const cases = [
    {
      protocol: "openai-completions", response: [
        'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"OpenAI reply"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', "data: [DONE]", "",
      ].join("\n\n"),
      check: (url, headers, body, image) => { assert.match(url, /\/chat\/completions$/); assert.equal(headers.get("authorization"), "Bearer scripted-key"); if (image) assert.match(JSON.stringify(body), /AQID/); },
    },
    {
      protocol: "anthropic-messages", response: [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"model-test","stop_reason":null,"usage":{"input_tokens":2,"output_tokens":1}}}',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anthropic reply"}}',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
        'event: message_stop\ndata: {"type":"message_stop"}', "",
      ].join("\n\n"),
      check: (url, headers, body, image) => { assert.match(url, /\/messages(?:\?|$)/); assert.equal(headers.get("x-api-key"), "scripted-key"); if (image) assert.match(JSON.stringify(body), /AQID/); },
    },
    {
      protocol: "google-generative-ai", response: [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Gemini reply"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":2}}', "",
      ].join("\n\n"),
      check: (url, headers, body, image) => { assert.match(url, /streamGenerateContent/); assert.equal(headers.get("x-goog-api-key"), "scripted-key"); if (image) assert.match(JSON.stringify(body), /AQID/); },
    },
  ];
  for (const item of cases) {
    for (const role of ["main", "vision"]) {
      const resolved = await resolveModelProfile(collection, {
        role, protocol: item.protocol, provider: "crossdoc-custom", modelId: "model-test",
        baseUrl: `https://mock.invalid/${item.protocol}`, apiKey: "scripted-key",
      }, role);
      let requestCount = 0;
      let capturedRequest;
      const fetch = async (input, init) => {
        requestCount += 1;
        const body = JSON.parse(init.body);
        capturedRequest = { url: String(input), headers: new Headers(init.headers), body };
        return new Response(item.response, { headers: { "content-type": "text/event-stream" } });
      };
      const originalFetch = globalThis.fetch;
      if (item.protocol === "google-generative-ai") globalThis.fetch = fetch;
      let message;
      try {
        message = await collection.completeSimple(resolved.model, {
          messages: [{ role: "user", content: role === "vision"
            ? [{ type: "text", text: "Read this page" }, { type: "image", data: "AQID", mimeType: "image/png" }]
            : "Say hello", timestamp: Date.now() }],
        }, { apiKey: "scripted-key", ...(item.protocol === "google-generative-ai" ? {} : { fetch }) });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(requestCount, 1, `${item.protocol} ${role} model routes through Pi once`);
      item.check(capturedRequest.url, capturedRequest.headers, capturedRequest.body, role === "vision");
      assert.match(textOf(message), /reply$/i, `${item.protocol} returns the scripted assistant text: ${JSON.stringify(message)}`);
    }
  }
}

async function readEvents(url, afterId = 0, until = "done") {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { "Last-Event-ID": String(afterId) }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes(`event: ${until}\n`)) {
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

async function postPdf(url, name, content) {
  return postPdfs(url, [{ name, content }]);
}

async function postPdfs(url, files) {
  const form = new FormData();
  for (const { name, content } of files) form.append("documents[]", new Blob([content], { type: "application/pdf" }), name);
  return fetch(url, { method: "POST", body: form });
}

async function main() {
  await verifyCustomPiProtocols();
  const root = await mkdtemp(join(tmpdir(), "crossdoc-web-read-"));
  const uploadDirectory = join(root, "uploads");
  const libraryDirectory = join(root, "library");
  const limitedUploadDirectory = join(root, "limited-uploads");
  await mkdir(uploadDirectory, { recursive: true });
  await mkdir(libraryDirectory, { recursive: true });
  await mkdir(limitedUploadDirectory, { recursive: true });
  let agentCount = 0;
  let activeReadOperations = 0;
  let maxActiveReadOperations = 0;
  const parseCallsByTitle = new Map();
  const app = createWebApp({
    uploadDirectory,
    libraryDirectory,
    publicDirectory: join(process.cwd(), "public"),
    pdfjsDirectory: join(process.cwd(), "node_modules/pdfjs-dist/build"),
    agentFactory: async (options) => {
      const selected = options.documents[0];
      if (selected.title === "missing-model.pdf") throw new CrossDocVisionModelConfigError("Test model is not configured.");
      agentCount += 1;
      const parsedResults = (messages) => messages.filter((item) => item.role === "toolResult");
      const streamFn = async (_model, context, streamOptions) => {
        const results = parsedResults(context.messages);
        const latestUser = [...context.messages].reverse().find((item) => item.role === "user");
        const userText = textOf(latestUser);
        const followUp = userText.includes("Question:");
        if (selected.title === "race-fail.pdf") {
          const parseResults = results.filter((item) => item.toolName === "parse_document");
          if (parseResults.length === 0) {
            return scriptedMessage(assistant([
              toolCall("parse_document", { documentId: options.documents[0].id }),
              toolCall("parse_document", { documentId: options.documents[1].id }),
            ], "toolUse"));
          }
          if (parseResults.length === 2) return scriptedMessage(assistant([toolCall("parse_document", { documentId: options.documents[2].id })], "toolUse"));
          if (parseResults.length === 3) return scriptedMessage(assistant([toolCall("parse_document", { documentId: options.documents[3].id })], "toolUse"));
          return scriptedMessage(assistant([{ type: "text", text: "Two documents were persisted successfully." }], "stop"));
        }
        if (selected.title === "duplicate-parse.pdf") {
          if (!results.some((item) => item.toolName === "parse_document")) {
            return scriptedMessage(assistant([
              toolCall("parse_document", { documentId: selected.id }),
              toolCall("parse_document", { documentId: selected.id }),
            ], "toolUse"));
          }
          return scriptedMessage(assistant([{ type: "text", text: "Parsed once." }], "stop"));
        }
        if (selected.title === "scan-budget.pdf") {
          if (!results.some((item) => item.toolName === "parse_document")) return scriptedMessage(assistant([toolCall("parse_document", { documentId: selected.id })], "toolUse"));
          if (!results.some((item) => item.toolName === "render_scan_page")) return scriptedMessage(assistant([toolCall("render_scan_page", { documentId: selected.id, page: 1 })], "toolUse"));
          if (!results.some((item) => item.toolName === "load_document_skill" && item.content?.some((part) => part.type === "text" && part.text.includes("Initial overview")))) {
            return scriptedMessage(assistant([toolCall("load_document_skill", { skill: "document-overview" })], "toolUse"));
          }
          return scriptedMessage(assistant([{ type: "text", text: `Scanned content. [[cite:${selected.id}:1]]` }], "stop"));
        }
        if (selected.title === "cancel.pdf" || (selected.title === "cancel-question.pdf" && followUp && results.some((item) => item.toolName === "search_document"))) {
          return new Promise((resolve) => {
            const finishCancelled = () => resolve(scriptedMessage(assistant([{ type: "text", text: "Cancelled." }], "stop")));
            if (streamOptions?.signal?.aborted) finishCancelled();
            else streamOptions?.signal?.addEventListener("abort", finishCancelled, { once: true });
          });
        }
        if (followUp) {
          if (!results.some((item) => item.toolName === "search_document")) {
            await new Promise((resolve) => setTimeout(resolve, 90));
            return scriptedMessage(assistant([toolCall("search_document", { query: "risk clause", documentIds: [selected.id] })], "toolUse"));
          }
          return scriptedMessage(assistant([{ type: "text", text: `Found the source clause. [[cite:${selected.id}:1]]` }], "stop"));
        }
        if (selected.title.startsWith("budget-") && !results.some((item) => item.toolName === "parse_document")) {
          return scriptedMessage(assistant([
            ...options.documents.map(({ id }) => toolCall("inspect_document", { documentId: id })),
            toolCall("load_document_skill", { skill: "pdf-reading" }),
            ...options.documents.map(({ id }) => toolCall("parse_document", { documentId: id })),
          ], "toolUse"));
        }
        if (selected.title === "skip.pdf") {
          if (!results.some((item) => item.toolName === "load_document_skill")) {
            return scriptedMessage(assistant([toolCall("load_document_skill", { skill: "document-overview" })], "toolUse"));
          }
          return scriptedMessage(assistant([{ type: "text", text: `文档约定了风险条款。 [[cite:${selected.id}:1]]` }], "stop"));
        }
        if (!results.some((item) => item.toolName === "parse_document")) {
          return scriptedMessage(assistant([
            toolCall("inspect_document", { documentId: selected.id }),
            toolCall("load_document_skill", { skill: "pdf-reading" }),
            toolCall("parse_document", { documentId: selected.id }),
          ], "toolUse"));
        }
        if (!results.some((item) => item.toolName === "load_document_skill" && item.content?.some((part) => part.type === "text" && part.text.includes("Initial overview")))) {
          return scriptedMessage(assistant([toolCall("load_document_skill", { skill: "document-overview" })], "toolUse"));
        }
        return scriptedMessage(assistant([{ type: "text", text: `文档约定了风险条款。 [[cite:${selected.id}:1]]` }], "stop"));
      };
      return createCrossDocAgent({
        ...options,
        models: models(),
        streamFn,
        mainProfile: { role: "main", provider: "test-provider", modelId: "scripted-vision", apiKey: "main-key" },
        visionProfile: { role: "vision", provider: "test-provider", modelId: "scripted-vision", apiKey: "vision-key" },
        visionModel: "test-provider/scripted-vision",
        visionCompleteSimple: async () => assistant([{ type: "text", text: "scripted OCR" }], "stop"),
        parseDocument: async (path, parseOptions) => {
          activeReadOperations += 1;
          maxActiveReadOperations = Math.max(maxActiveReadOperations, activeReadOperations);
          try {
            const title = parseOptions?.title ?? "";
            parseCallsByTitle.set(title, (parseCallsByTitle.get(title) ?? 0) + 1);
            if (title === "oversized.pdf") {
              return { id: parseOptions.id, title, format: "pdf", pages: [], blocks: [], text: "x".repeat(1_000_001), markdown: "", warnings: [] };
            }
            if (title.startsWith("budget-")) {
              return { id: parseOptions.id, title, format: "pdf", pages: [], blocks: [], text: "x".repeat(700_000), markdown: "# Budget document", warnings: [] };
            }
            if (title.startsWith("race-")) {
              return { id: parseOptions.id, title, format: "pdf", pages: [], blocks: [], text: "x".repeat(1_000_000), markdown: "# Race document", warnings: [] };
            }
            if (title === "scan-budget.pdf") {
              const text = "x".repeat(999_999);
              return {
                id: parseOptions.id, title, format: "pdf", text, blocks: [], markdown: "# Scan budget",
                pages: [{ page: 1, text, blocks: [], classification: "scan-candidate", extractionMethod: "pending-vision", pageBounds: [0, 0, 612, 792] }],
                warnings: [],
              };
            }
            await new Promise((resolve) => setTimeout(resolve, 80));
            return await parseDoc(path, parseOptions);
          } catch (error) {
            activeReadOperations -= 1;
            throw error;
          }
        },
        onDocumentUpdated: async (document, source) => {
          try {
            if (source.title === "race-fail.pdf") {
              await new Promise((resolve) => setTimeout(resolve, 120));
              throw new Error("scripted archive failure");
            }
            await options.onDocumentUpdated?.(document, source);
          } finally {
            activeReadOperations -= 1;
          }
        },
        renderScanPage: async () => ({ bytes: Buffer.from([137, 80, 78, 71]), width: 1, height: 1 }),
      });
    },
  });
  const server = listenWebApp(app, 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const uploadLimitServer = listenWebApp(createWebApp({ uploadDirectory: limitedUploadDirectory, maxTotalUploadBytes: 1 }), 0);
  await new Promise((resolve) => uploadLimitServer.once("listening", resolve));
  const uploadLimitAddress = uploadLimitServer.address();
  assert.ok(uploadLimitAddress && typeof uploadLimitAddress === "object");
  const uploadLimitUrl = `http://127.0.0.1:${uploadLimitAddress.port}`;

  try {
    assert.equal(isUploadSelectionWithinLimit([{ size: 100 * 1024 * 1024 }]), true);
    assert.equal(isUploadSelectionWithinLimit([{ size: 25 * 1024 * 1024 }, { size: 25 * 1024 * 1024 }, { size: 25 * 1024 * 1024 }, { size: 25 * 1024 * 1024 }, { size: 1 }]), false);
    const aggregateUpload = await postPdf(`${uploadLimitUrl}/api/read`, "over-total.pdf", pdfBytes("Over total"));
    assert.equal(aggregateUpload.status, 413);
    assert.match((await aggregateUpload.json()).error, /100 MiB total upload limit/);
    assert.deepEqual(await readdir(limitedUploadDirectory), [], "aggregate upload rejection must remove staged files");
    const invalid = await postPdf(`${baseUrl}/api/read`, "fake.pdf", Buffer.from("not a pdf"));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await readdir(uploadDirectory), [], "invalid PDFs should be deleted from temporary upload storage");

    const missingModel = await postPdf(`${baseUrl}/api/read`, "missing-model.pdf", pdfBytes("Configuration test"));
    assert.equal(missingModel.status, 503, "model setup errors should be returned before accepting a session");
    assert.deepEqual(await readdir(uploadDirectory), [], "uploads must be cleaned when agent setup fails");

    const mixedForm = new FormData();
    mixedForm.append("documents[]", new Blob([pdfBytes("Risk clause: notice within ten business days")], { type: "application/pdf" }), "合同.pdf");
    mixedForm.append("documents[]", new Blob(["broken PDF"], { type: "application/pdf" }), "损坏.pdf");
    const accepted = await fetch(`${baseUrl}/api/read`, { method: "POST", body: mixedForm });
    assert.equal(accepted.status, 202);
    const session = await accepted.json();
    assert.match(session.sessionId, /^[0-9a-f-]{36}$/i);
    assert.equal(session.documents.length, 2);
    assert.equal(session.documents[0].state, "waiting");
    assert.equal(session.documents[1].state, "failed");
    const eventUrl = `${baseUrl}/api/read/${session.sessionId}/events`;
    const initialEvents = await readEvents(eventUrl);
    assert.match(initialEvents, /event: progress/);
    assert.match(initialEvents, /event: document/);
    assert.match(initialEvents, /event: overview/);
    assert.match(initialEvents, /\[\[cite:/);
    assert.match(initialEvents, /event: done/);
    assert.match(initialEvents, /"status":"partial"/);
    assert.doesNotMatch(initialEvents, /compare_claims|report_conflicts/);
    const eventIds = [...initialEvents.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.ok(eventIds.length > 3);

    const replay = await readEvents(eventUrl, 2);
    const replayIds = [...replay.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.ok(replayIds.length > 0 && replayIds.every((id) => id > 2), "SSE replay must honor Last-Event-ID");
    assert.match(replay, /event: overview/);
    assert.match(replay, /event: done/);

    const item = session.documents[0];
    assert.equal(session.documents[1].state, "failed");
    const source = await fetch(`${baseUrl}/api/library/${item.id}/source`);
    assert.equal(source.status, 200);
    assert.equal(Buffer.from(await source.arrayBuffer()).subarray(0, 5).toString("ascii"), "%PDF-");
    const markdownResponse = await fetch(`${baseUrl}/api/library/${item.id}/markdown`);
    assert.equal(markdownResponse.status, 200);
    assert.match(await markdownResponse.text(), /Risk clause/);
    assert.deepEqual(await readdir(uploadDirectory), [], "completed sessions should clean up staged sources after archival");

    const question = await fetch(`${baseUrl}/api/read/${session.sessionId}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "What is the risk clause?" }),
    });
    assert.equal(question.status, 202);
    const busyQuestion = await fetch(`${baseUrl}/api/read/${session.sessionId}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Second question" }),
    });
    assert.equal(busyQuestion.status, 409);
    const answerEvents = await readEvents(eventUrl, eventIds.at(-1), "answer");
    assert.match(answerEvents, /event: answer/);
    assert.match(answerEvents, /Found the source clause/);
    assert.match(answerEvents, new RegExp(item.id));
    assert.equal(agentCount, 1, "follow-up questions must stay in the same Pi agent session");

    const concurrentReads = await Promise.all(Array.from({ length: 4 }, (_, index) => postPdf(
      `${baseUrl}/api/read`, `parallel-${index}.pdf`, pdfBytes(`Parallel parse ${index}`),
    )));
    assert.ok(concurrentReads.every((result) => result.status === 202), "six-session cap should admit four concurrent parse sessions");
    const concurrentSessions = await Promise.all(concurrentReads.map((result) => result.json()));
    const concurrentEvents = await Promise.all(concurrentSessions.map(({ sessionId }) => readEvents(`${baseUrl}/api/read/${sessionId}/events`)));
    assert.ok(concurrentEvents.every((events) => /"status":"completed"/.test(events)));
    assert.equal(maxActiveReadOperations, 3, "parse and archive work across separate Web sessions must share the process-wide cap of three");

    const rollbackFiles = ["race-fail.pdf", "race-kept.pdf", "race-third.pdf", "race-fourth.pdf"]
      .map((name) => ({ name, content: pdfBytes(name) }));
    const rollbackResponse = await postPdfs(`${baseUrl}/api/read`, rollbackFiles);
    assert.equal(rollbackResponse.status, 202);
    const rollbackSession = await rollbackResponse.json();
    const rollbackEvents = await readEvents(`${baseUrl}/api/read/${rollbackSession.sessionId}/events`);
    assert.match(rollbackEvents, /scripted archive failure/);
    assert.match(rollbackEvents, /exceeds the 2,000,000 character per-session limit/);
    assert.match(rollbackEvents, /"status":"partial"/);
    for (const index of [1, 2]) {
      assert.equal((await fetch(`${baseUrl}/api/library/${rollbackSession.documents[index].id}/source`)).status, 200, "successful concurrent reservations must remain counted after another document's archive failure");
    }
    assert.equal((await fetch(`${baseUrl}/api/library/${rollbackSession.documents[3].id}/source`)).status, 404, "the next document beyond the corrected 2M ledger must be rejected");

    const duplicateResponse = await postPdf(`${baseUrl}/api/read`, "duplicate-parse.pdf", pdfBytes("Duplicate parse"));
    assert.equal(duplicateResponse.status, 202);
    const duplicateSession = await duplicateResponse.json();
    assert.match(await readEvents(`${baseUrl}/api/read/${duplicateSession.sessionId}/events`), /"status":"completed"/);
    assert.equal(parseCallsByTitle.get("duplicate-parse.pdf"), 1, "parallel duplicate parse calls for one document should share one parse/archive operation");

    const budgetFiles = [0, 1, 2].map((index) => ({ name: `budget-${index}.pdf`, content: pdfBytes(`Budget ${index}`) }));
    const budgetResponse = await postPdfs(`${baseUrl}/api/read`, budgetFiles);
    assert.equal(budgetResponse.status, 202);
    const budgetSession = await budgetResponse.json();
    const budgetEvents = await readEvents(`${baseUrl}/api/read/${budgetSession.sessionId}/events`);
    assert.match(budgetEvents, /exceeds the 2,000,000 character per-session limit/);
    assert.match(budgetEvents, /"status":"partial"/);
    const budgetStates = [...budgetEvents.matchAll(/"id":"([0-9a-f-]+)"[^\n]*"state":"(ready|failed)"/g)].map((match) => match[2]);
    assert.equal(budgetStates.filter((state) => state === "ready").length, 2, "two 700k documents should fit under the session character cap");
    assert.equal(budgetStates.filter((state) => state === "failed").length, 1, "the third document should be rejected before archive");
    const thirdBudgetArchive = await fetch(`${baseUrl}/api/library/${budgetSession.documents[2].id}/source`);
    assert.equal(thirdBudgetArchive.status, 404, "a document rejected by the session content budget must not be archived");

    const oversizedResponse = await postPdf(`${baseUrl}/api/read`, "oversized.pdf", pdfBytes("Oversized text source"));
    assert.equal(oversizedResponse.status, 202);
    const oversizedSession = await oversizedResponse.json();
    const oversizedEvents = await readEvents(`${baseUrl}/api/read/${oversizedSession.sessionId}/events`);
    assert.match(oversizedEvents, /exceeds the 1,000,000 character per-document limit/);
    assert.match(oversizedEvents, /"status":"failed"/);
    assert.equal((await fetch(`${baseUrl}/api/library/${oversizedSession.documents[0].id}/source`)).status, 404);

    const scanBudgetResponse = await postPdf(`${baseUrl}/api/read`, "scan-budget.pdf", pdfBytes("Scan budget source"));
    assert.equal(scanBudgetResponse.status, 202);
    const scanBudgetSession = await scanBudgetResponse.json();
    const scanBudgetEvents = await readEvents(`${baseUrl}/api/read/${scanBudgetSession.sessionId}/events`);
    assert.match(scanBudgetEvents, /per-document limit; this file was not archived/);
    assert.match(scanBudgetEvents, /"state":"failed"/);
    assert.equal((await fetch(`${baseUrl}/api/library/${scanBudgetSession.documents[0].id}/source`)).status, 404, "OCR that exceeds the text cap must remove the previously archived native document");

    const questionCancelResponse = await postPdf(`${baseUrl}/api/read`, "cancel-question.pdf", pdfBytes("Question cancel source"));
    assert.equal(questionCancelResponse.status, 202);
    const questionCancelSession = await questionCancelResponse.json();
    const questionCancelUrl = `${baseUrl}/api/read/${questionCancelSession.sessionId}/events`;
    const questionInitialEvents = await readEvents(questionCancelUrl);
    assert.match(questionInitialEvents, /"status":"completed"/);
    const questionInitialIds = [...questionInitialEvents.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    const questionCancelAccepted = await fetch(`${baseUrl}/api/read/${questionCancelSession.sessionId}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Cancel this question" }),
    });
    assert.equal(questionCancelAccepted.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const questionCancel = await fetch(`${baseUrl}/api/read/${questionCancelSession.sessionId}/cancel`, { method: "POST" });
    assert.equal(questionCancel.status, 200);
    const cancelledQuestionEvents = await readEvents(questionCancelUrl, questionInitialIds.at(-1));
    assert.match(cancelledQuestionEvents, /追问已取消/);
    assert.match(cancelledQuestionEvents, /"phase":"answer","state":"cancelled"/);
    assert.match(cancelledQuestionEvents, /"status":"cancelled","operation":"question"/);
    const afterCancelQuestion = await fetch(`${baseUrl}/api/read/${questionCancelSession.sessionId}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Try again" }),
    });
    assert.equal(afterCancelQuestion.status, 409, "a cancelled question terminates the session and unlocks the composer into its disabled state");

    const skippedResponse = await postPdf(`${baseUrl}/api/read`, "skip.pdf", pdfBytes("Agent skip source"));
    assert.equal(skippedResponse.status, 202);
    const skippedSession = await skippedResponse.json();
    const skippedEvents = await readEvents(`${baseUrl}/api/read/${skippedSession.sessionId}/events`);
    assert.match(skippedEvents, /"state":"failed","error":"The Agent did not parse this selected document\."/);
    assert.match(skippedEvents, /"status":"failed"/);
    const skippedDocumentId = skippedSession.documents[0].id;
    const skippedArchive = await fetch(`${baseUrl}/api/library/${skippedDocumentId}/source`);
    assert.equal(skippedArchive.status, 404, "a selected but unparsed PDF must not be marked ready or linked as archived");
    const clientSource = await readFile(join(process.cwd(), "public/index.html"), "utf8");
    assert.match(clientSource, /readDocuments\.filter\(\(item\) => item\.state === "ready"\)/, "citation links must be limited to ready, archived documents");
    assert.match(clientSource, /!Number\.isSafeInteger\(source\.pages\) \|\| pageNumber > source\.pages/, "citation links must reject unknown page counts and numbers outside the archived PDF");
    assert.match(clientSource, /function profileIsComplete\(profile\)[\s\S]*?profile\.provider && \(profile\.apiKeyConfigured \|\| profile\.authAvailable\)[\s\S]*?profile\.protocol && profile\.baseUrl && profile\.apiKeyConfigured/, "legacy catalog profiles accept a saved or ambient credential, while custom profiles require a saved key");
    assert.match(clientSource, /fillSetupForms\(models\);\s*setView\("selection"\);/, "app entry always opens the upload view; model configuration is not a startup gate");
    assert.doesNotMatch(clientSource, /if \(\["main", "vision"\]\.every\(\(role\) => profileIsComplete\(models\[role\]\)\)\)/, "saved profile completeness must not gate app entry");
    assert.doesNotMatch(clientSource, /model-warning|id="model-warning"/, "the selection view stays free of an extra model-configuration notice; the header tab is the only entry point");
    assert.match(clientSource, /data-view="selection"[\s\S]*?data-view="library"[\s\S]*?data-view="models"/, "the header exposes upload / library / model configuration as switchable views");
    assert.match(clientSource, /placeholder="输入或加载模型 ID"/, "model ID remains editable for manual entry if discovery fails");
    assert.match(clientSource, /import \{ buildLedgerModel, mountLedger \} from "\/js\/conflict-ledger\.js"/, "the review console renders conflicts through the shared ledger component");
    assert.match(clientSource, /id="review-screen"/, "the review console is its own screen");
    assert.doesNotMatch(clientSource, /class="shell"|id="findings"|id="claim-pair"|id="evidence-list"/, "the review console keeps no legacy list/detail split");
    assert.match(clientSource, /window\.crossdocApplyReviewResult = applyReviewResult/, "a finished review reaches the ledger through one documented seam");
    const clientStyles = await readFile(join(process.cwd(), "public/styles.css"), "utf8");
    assert.match(clientStyles, /\.ledger-entry\b/, "the ledger component ships its styles in the shared stylesheet");

    const cancelledResponse = await postPdf(`${baseUrl}/api/read`, "cancel.pdf", pdfBytes("Cancel source"));
    assert.equal(cancelledResponse.status, 202);
    const cancelledSession = await cancelledResponse.json();
    const cancelled = await fetch(`${baseUrl}/api/read/${cancelledSession.sessionId}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).cancelled, true);
    const cancellationEvents = await readEvents(`${baseUrl}/api/read/${cancelledSession.sessionId}/events`, 0);
    assert.match(cancellationEvents, /"status":"cancelled"/);

    console.log("Web PDF reading checks passed (upload limits/cleanup, cross-session parse cap, document/session text budgets, archive gating, source+Markdown archive, overview, SSE replay, same-Agent Q&A, busy rejection, cancellation).");
  } finally {
    await new Promise((resolve) => uploadLimitServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

await main();
