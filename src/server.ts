import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { MutableModels } from "@earendil-works/pi-ai";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";

import { createBuiltinModels, createCrossDocAgent, CrossDocVisionModelConfigError, profileRequestOptions, resolveModelProfile, type CrossDocAgentOptions, type ScopedDocument } from "./agent.js";
import { runConsistencyReview } from "./review-run.js";
import { loadSkills } from "./skills/loader.js";
import {
  deleteUserSkill,
  importUserSkill,
  listUserSkills,
  validateUserSkill,
  writeUserSkill,
} from "./skills/user-store.js";
import { getLibraryDocument, listLibraryDocuments, saveLibraryDocument } from "./storage/library-store.js";
import { LocalDatabase, type ModelProfile, type ModelProtocol, type ModelRole } from "./storage/database.js";
import { listReviewArtifacts, readReviewArtifact, writeReviewArtifacts } from "./storage/review-store.js";
import type { ReviewResult } from "./core/types.js";

const port = Number(process.env.PORT ?? 5177);
export const LOCAL_BIND_HOST = "127.0.0.1";
const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UPLOADS = 12;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024;
const MAX_SESSIONS = 6;
const MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1_000;
const SESSION_IDLE_TTL_MS = 60 * 60 * 1_000;
const MAX_RETAINED_EVENTS = 500;
const MAX_SESSION_EVENT_BYTES = 256 * 1024;
const MAX_TOTAL_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_QUESTIONS_PER_SESSION = 30;
const MAX_RETAINED_ANSWERS = 10;
const MAX_AGENT_TEXT_CHARS = 12_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const MODEL_DISCOVERY_MAX_BYTES = 1_048_576;
const customModelProtocols = new Set<ModelProtocol>(["openai-completions", "anthropic-messages", "google-generative-ai"]);

export function isUploadSelectionWithinLimit(files: readonly { size: number }[], maximumBytes = MAX_TOTAL_UPLOAD_SIZE): boolean {
  return files.reduce((total, file) => total + file.size, 0) <= maximumBytes;
}

/**
 * The content hash of a file, or an empty string when it cannot be read.
 *
 * The hash is what says two documents have the same content. It is an index,
 * not a decision: the library keeps every upload.
 */
export async function contentHashOf(path: string): Promise<string> {
  try {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return "";
  }
}

/**
 * The body the review console reads.
 *
 * A live review and a stored review produce the same shape, so opening a past
 * review from the library shows exactly what it showed when it ran.
 */
export function reviewResponseBody(result: ReviewResult & { stages?: string[] }, reviewId: string): Record<string, unknown> {
  return {
    type: "result",
    reviewId,
    documents: result.documents.map((document) => ({
      id: document.id,
      title: document.title,
      pages: document.pages.length,
      format: document.format,
      markdown: document.markdown,
      warnings: document.warnings,
      sourceUrl: `/api/library/${document.id}/source`,
    })),
    claimCount: result.claims.length,
    conflictCount: result.conflicts.length,
    verifiedConflictCount: result.conflicts.filter((conflict) => conflict.status === "verified").length,
    judgeSource: result.judgeSource ?? "model",
    stages: result.stages ?? [],
    ...(result.warning ? { warning: result.warning } : {}),
    conflicts: result.conflicts,
    reportMarkdown: result.reportMarkdown,
  };
}

type ReadDocumentState = "waiting" | "reading" | "ready" | "failed";
type ReadEventType = "progress" | "document" | "overview" | "answer" | "error" | "done";

class SessionCapacityError extends Error {}

interface ReadDocument {
  id: string;
  title: string;
  state: ReadDocumentState;
  pages?: number;
  error?: string;
  sourceUrl?: string;
  markdownUrl?: string;
  /** Set when this file's content is already in the library. */
  duplicateOf?: DuplicateOf;
}

/** An archived document that has the same content as a newly uploaded file. */
export interface DuplicateOf {
  id: string;
  title: string;
  uploadedAt: string;
}

interface ReadEvent {
  id: number;
  type: ReadEventType;
  data: Record<string, unknown>;
  byteLength: number;
  createdAt: number;
}

interface ReadSession {
  id: string;
  agent: Agent;
  documents: ReadDocument[];
  parsedDocumentIds: Set<string>;
  archivedDocumentIds: Set<string>;
  events: ReadEvent[];
  eventBytes: number;
  nextEventId: number;
  answers: Array<{ question: string; text: string }>;
  overview?: string;
  lastDone?: Record<string, unknown>;
  listeners: Set<Response>;
  stagedPaths: string[];
  busy: boolean;
  cancelled: boolean;
  initialCompleted: boolean;
  terminated: boolean;
  questionCount: number;
  createdAt: number;
  lastActivityAt: number;
  currentRun: "initial" | "question" | null;
  currentAssistantText: string;
}

export interface WebAppOptions {
  publicDirectory?: string;
  uploadDirectory?: string;
  libraryDirectory?: string;
  dataDirectory?: string;
  reviewDirectory?: string;
  pdfjsDirectory?: string;
  /** Test seam for exercising aggregate upload rejection without allocating 100 MiB. */
  maxTotalUploadBytes?: number;
  /** Test seams for bounded server-side custom model discovery. */
  modelDiscoveryFetch?: typeof fetch;
  modelDiscoveryTimeoutMs?: number;
  modelDiscoveryMaxBytes?: number;
  /** Test seam: lets an integration test drive the review with a scripted catalog. */
  models?: MutableModels;
  agentFactory?: (options: CrossDocAgentOptions) => Promise<Agent>;
}

interface DiscoveredModel {
  id: string;
  name: string;
}

function normalizeModelId(protocol: ModelProtocol, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.length > 300 || /[\u0000-\u001f]/.test(id)) return undefined;
  return protocol === "google-generative-ai" ? id.replace(/^models\//, "") : id;
}

export function normalizeDiscoveredModels(protocol: ModelProtocol, payload: unknown): DiscoveredModel[] {
  if (!customModelProtocols.has(protocol) || !payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const object = payload as Record<string, unknown>;
  const values = protocol === "google-generative-ai" ? object.models : object.data;
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: DiscoveredModel[] = [];
  for (const value of values.slice(0, 500)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const model = value as Record<string, unknown>;
    const id = normalizeModelId(protocol, model.id ?? model.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const labelValue = model.displayName ?? model.display_name ?? model.name ?? id;
    const name = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim().slice(0, 300) : id;
    result.push({ id, name });
  }
  return result;
}

async function readBoundedJson(response: globalThis.Response, maxBytes: number): Promise<unknown> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Model discovery response exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body) throw new Error("Model discovery returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Model discovery response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Model discovery returned invalid JSON.");
  }
}

function validateCustomBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function cleanDisplayName(value: string): string {
  const name = basename(value.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (name || "document.pdf").slice(0, 240);
}

function eventText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part: unknown): part is { type: "text"; text: string } =>
      Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"))
    .map((part: { text: string }) => part.text)
    .join("\n")
    .trim();
}

function boundedErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.length > 4_000 ? `${message.slice(0, 4_000)}…[truncated]` : message;
}

function toolDetails(event: Extract<AgentEvent, { type: "tool_execution_end" }>): Record<string, unknown> {
  const result = event.result as { details?: unknown; structuredContent?: unknown } | undefined;
  const value = result?.details ?? result?.structuredContent;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function createWebApp(options: WebAppOptions = {}) {
  const uploadDirectory = resolve(options.uploadDirectory ?? ".crossdoc/uploads");
  const publicDirectory = resolve(options.publicDirectory ?? "public");
  const libraryDirectory = resolve(options.libraryDirectory ?? "data/library");
  const dataDirectory = resolve(options.dataDirectory ?? dirname(libraryDirectory));
  const database = new LocalDatabase(dataDirectory);
  const modelCatalog = options.models ?? createBuiltinModels();
  const reviewDirectory = resolve(options.reviewDirectory ?? ".crossdoc/reviews");
  const userSkillsDirectory = resolve(dataDirectory, "skills");
  const pdfjsDirectory = resolve(options.pdfjsDirectory ?? "node_modules/pdfjs-dist/build");
  const maxTotalUploadBytes = options.maxTotalUploadBytes ?? MAX_TOTAL_UPLOAD_SIZE;
  const discoveryFetch = options.modelDiscoveryFetch ?? fetch;
  const discoveryTimeoutMs = options.modelDiscoveryTimeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS;
  const discoveryMaxBytes = options.modelDiscoveryMaxBytes ?? MODEL_DISCOVERY_MAX_BYTES;
  const agentFactory = options.agentFactory ?? createCrossDocAgent;
  const sessions = new Map<string, ReadSession>();
  let pendingSessionSlots = 0;
  let totalEventBytes = 0;

  /**
   * Finds the archived document whose content matches an uploaded file.
   *
   * The library keeps every upload, so this is a marker rather than a
   * decision: the caller tells the user that this content is already there.
   */
  async function findDuplicateOf(file: Express.Multer.File): Promise<DuplicateOf | undefined> {
    const sha256 = await contentHashOf(file.path);
    if (!sha256) return undefined;
    const existing = database.findDocumentBySha256(sha256);
    if (!existing) return undefined;
    return { id: existing.id, title: existing.title, uploadedAt: existing.uploadedAt };
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => {
        void mkdir(uploadDirectory, { recursive: true }).then(() => callback(null, uploadDirectory)).catch((error: Error) => callback(error, uploadDirectory));
      },
      filename: (_request, _file, callback) => callback(null, `${randomUUID()}.pdf`),
    }),
    limits: { files: MAX_UPLOADS, fileSize: MAX_FILE_SIZE },
    fileFilter: (_request, file, callback) => {
      if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
        callback(null, true);
        return;
      }
      callback(new Error("Only PDF files are supported."));
    },
  });

  const app = express();
  app.locals.database = database;
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(publicDirectory));
  app.use("/vendor/pdfjs", express.static(pdfjsDirectory, { maxAge: "1y", immutable: true }));

  const publicModelProfile = async (role: ModelRole) => {
    const profile = database.getModelProfile(role);
    if (!profile) return null;
    const apiKeyConfigured = Boolean(profile.apiKey);
    let ambientAuthAvailable = false;
    if ((profile.protocol ?? "catalog") === "catalog") {
      try {
        ambientAuthAvailable = Boolean(await modelCatalog.checkAuth(profile.provider));
      } catch {
        ambientAuthAvailable = false;
      }
    }
    return {
      role,
      ...(profile.protocol === "catalog" || !profile.protocol ? { provider: profile.provider } : {}),
      protocol: profile.protocol ?? "catalog",
      modelId: profile.modelId,
      baseUrl: profile.baseUrl ?? "",
      options: profile.options ?? {},
      apiKeyConfigured,
      authAvailable: apiKeyConfigured || ambientAuthAvailable,
    };
  };

  app.get("/api/settings", async (_request, response) => {
    const [main, vision] = await Promise.all([publicModelProfile("main"), publicModelProfile("vision")]);
    response.json({ models: { main, vision }, preferences: {} });
  });

  app.post("/api/settings/models/discover", async (request, response) => {
    const body = request.body as Record<string, unknown>;
    const role = body.role;
    const protocol = body.protocol;
    const baseUrl = typeof body.baseUrl === "string" ? validateCustomBaseUrl(body.baseUrl.trim()) : undefined;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (role !== "main" && role !== "vision") return response.status(400).json({ error: "Choose a model role before loading models." });
    if (typeof protocol !== "string" || !customModelProtocols.has(protocol as ModelProtocol)) {
      return response.status(400).json({ error: "Choose one of the supported custom model protocols." });
    }
    if (!baseUrl) return response.status(400).json({ error: "Enter a valid HTTP or HTTPS Base URL without credentials, query, or fragment." });
    if (!apiKey || apiKey.length > 8_000) return response.status(400).json({ error: "Enter an API key under 8,000 characters to load models." });
    const headers: Record<string, string> = { Accept: "application/json" };
    if (protocol === "openai-completions") headers.Authorization = `Bearer ${apiKey}`;
    else if (protocol === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else headers["x-goog-api-key"] = apiKey;
    try {
      const url = `${baseUrl}/models`;
      const responseFromProvider = await discoveryFetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(discoveryTimeoutMs),
      });
      if (!responseFromProvider.ok) {
        await responseFromProvider.body?.cancel().catch(() => undefined);
        return response.status(502).json({ error: `Model endpoint returned HTTP ${responseFromProvider.status}. Check the Base URL, API key, and protocol.` });
      }
      const payload = await readBoundedJson(responseFromProvider, discoveryMaxBytes);
      response.json({ models: normalizeDiscoveredModels(protocol as ModelProtocol, payload) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timeout|timed out|abort/i.test(message);
      response.status(502).json({ error: timedOut
        ? `Model discovery timed out after ${discoveryTimeoutMs} ms. Check the Base URL and try again.`
        : message });
    }
  });

  app.put("/api/settings/models/:role", async (request, response) => {
    const role = request.params.role;
    if (role !== "main" && role !== "vision") return response.status(404).json({ error: "Unknown model role." });
    const body = request.body as Record<string, unknown>;
    const protocolValue = body.protocol;
    const protocol: ModelProtocol = protocolValue === undefined ? "catalog" : protocolValue as ModelProtocol;
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (protocol !== "catalog" && !customModelProtocols.has(protocol)) return response.status(400).json({ error: "Choose one of the supported model protocols." });
    const custom = protocol !== "catalog";
    const provider = custom ? "crossdoc-custom" : typeof body.provider === "string" ? body.provider.trim() : "";
    if (!modelId) return response.status(400).json({ error: "Model ID is required." });
    if (custom) {
      const baseUrl = typeof body.baseUrl === "string" ? validateCustomBaseUrl(body.baseUrl.trim()) : undefined;
      if (!baseUrl) return response.status(400).json({ error: "Enter a valid HTTP or HTTPS Base URL without credentials, query, or fragment." });
      if (typeof body.apiKey === "string" && body.apiKey.length > 8_000) return response.status(400).json({ error: "API key must be under 8,000 characters." });
      body.baseUrl = baseUrl;
    } else {
      if (!provider) return response.status(400).json({ error: "Provider and model ID are required." });
      const model = modelCatalog.getModel(provider, modelId);
      if (!model) return response.status(400).json({ error: `Model ${provider}/${modelId} is not in Pi AI's model catalog.` });
      if (role === "vision" && !model.input.includes("image")) {
        return response.status(400).json({ error: `Model ${provider}/${modelId} does not accept images. Choose an image-capable vision model.` });
      }
    }
    if (body.baseUrl !== undefined && (typeof body.baseUrl !== "string" || body.baseUrl.length > 2_000)) {
      return response.status(400).json({ error: "Base URL must be text under 2,000 characters." });
    }
    if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || body.apiKey.length > 8_000)) {
      return response.status(400).json({ error: "API key must be text under 8,000 characters." });
    }
    const options = body.options === undefined ? undefined : body.options;
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options) || JSON.stringify(options).length > 8_000)) {
      return response.status(400).json({ error: "Provider options must be a JSON object under 8,000 characters." });
    }
    try {
      database.saveModelProfile({
        role,
        provider,
        protocol,
        modelId,
        ...(typeof body.baseUrl === "string" && body.baseUrl.trim() ? { baseUrl: body.baseUrl.trim() } : {}),
        ...(typeof body.apiKey === "string" && body.apiKey.trim() ? { apiKey: body.apiKey.trim() } : {}),
        ...(options === undefined ? {} : { options: options as Record<string, unknown> }),
      }, body.clearApiKey === true);
      response.json({ model: await publicModelProfile(role) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Unable to save model settings." });
    }
  });

  /**
   * Checks that a model endpoint answers, before it is relied on.
   *
   * The test runs against its own model catalog, so testing a draft endpoint
   * never replaces the profile the rest of the app uses.
   */
  app.post("/api/settings/models/test", async (request, response) => {
    const body = request.body as Record<string, unknown>;
    const role = body.role;
    if (role !== "main" && role !== "vision") {
      response.status(400).json({ error: "Choose a model role to test." });
      return;
    }
    const protocolValue = body.protocol;
    const protocol: ModelProtocol = protocolValue === undefined ? "catalog" : protocolValue as ModelProtocol;
    if (protocol !== "catalog" && !customModelProtocols.has(protocol)) {
      response.status(400).json({ error: "Choose one of the supported custom model protocols." });
      return;
    }
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId) {
      response.status(400).json({ error: "Enter a model ID before testing." });
      return;
    }
    const baseUrl = typeof body.baseUrl === "string" ? validateCustomBaseUrl(body.baseUrl.trim()) : undefined;
    if (protocol !== "catalog" && !baseUrl) {
      response.status(400).json({ error: "Enter a valid HTTP or HTTPS Base URL without credentials, query, or fragment." });
      return;
    }
    const typedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const apiKey = typedKey || database.getModelProfile(role)?.apiKey || "";

    const testModels = createBuiltinModels();
    const profile: ModelProfile = {
      role,
      protocol,
      modelId,
      provider: protocol === "catalog" ? (typeof body.provider === "string" ? body.provider.trim() : "") : "crossdoc-custom",
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      options: {},
    };

    const started = Date.now();
    try {
      const resolved = await resolveModelProfile(testModels, profile, role);
      const reply = await testModels.completeSimple(resolved.model, {
        messages: [{
          role: "user",
          content: [{ type: "text", text: "Reply with the single word: ok" }],
          timestamp: Date.now(),
        }],
      }, {
        ...profileRequestOptions(resolved.profile),
        ...(resolved.profile.apiKey ? { apiKey: resolved.profile.apiKey } : {}),
      });
      const text = reply.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text ?? "")
        .join("")
        .trim();
      response.json({
        ok: true,
        modelId: resolved.profile.modelId,
        latencyMs: Date.now() - started,
        reply: text.slice(0, 120),
        ...(role === "vision" ? { note: "Connectivity only. Image input is exercised when a scanned page is read." } : {}),
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "The model endpoint did not answer.",
        latencyMs: Date.now() - started,
      });
    }
  });

  function emit(session: ReadSession, type: ReadEventType, data: Record<string, unknown>) {
    const serializedData = JSON.stringify(data);
    const byteLength = Buffer.byteLength(`id: ${session.nextEventId}\nevent: ${type}\ndata: ${serializedData}\n\n`);
    const event: ReadEvent = { id: session.nextEventId++, type, data, byteLength, createdAt: Date.now() };
    session.events.push(event);
    session.eventBytes += byteLength;
    totalEventBytes += byteLength;
    session.lastActivityAt = Date.now();
    const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${serializedData}\n\n`;
    for (const response of session.listeners) {
      if (!response.writableEnded) response.write(payload);
    }
    while (session.events.length > MAX_RETAINED_EVENTS || session.eventBytes > MAX_SESSION_EVENT_BYTES || totalEventBytes > MAX_TOTAL_EVENT_BYTES) {
      const oldestSession = [...sessions.values()].filter((item) => item.events.length > 0)
        .sort((left, right) => left.events[0]!.createdAt - right.events[0]!.createdAt)[0];
      if (!oldestSession) break;
      const dropped = oldestSession.events.shift()!;
      oldestSession.eventBytes -= dropped.byteLength;
      totalEventBytes -= dropped.byteLength;
    }
  }

  function setDocument(session: ReadSession, id: string, update: Partial<ReadDocument>) {
    const document = session.documents.find((item) => item.id === id);
    if (!document) return;
    Object.assign(document, update);
    emit(session, "document", { ...document });
  }

  async function cleanupStaged(session: ReadSession) {
    const paths = session.stagedPaths.splice(0);
    await Promise.all(paths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)));
  }

  function finish(session: ReadSession, status: "completed" | "partial" | "cancelled" | "failed", operation?: "initial" | "question") {
    if (session.terminated || (session.initialCompleted && status !== "cancelled")) return;
    if (status === "cancelled") session.terminated = true;
    else session.initialCompleted = true;
    session.busy = false;
    session.currentRun = null;
    const payload = { status, ...(operation ? { operation } : {}) };
    session.lastDone = payload;
    emit(session, "done", payload);
    void cleanupStaged(session);
  }

  async function retireSession(session: ReadSession, reason = "Reading session expired.") {
    if (!sessions.has(session.id)) return;
    sessions.delete(session.id);
    session.cancelled = true;
    session.terminated = true;
    if (session.busy) session.agent.abort();
    emit(session, "error", { operation: "session", message: reason });
    for (const listener of session.listeners) listener.end();
    session.listeners.clear();
    await cleanupStaged(session);
    totalEventBytes -= session.eventBytes;
    session.eventBytes = 0;
    session.events.length = 0;
    session.answers.length = 0;
    session.documents.length = 0;
    session.parsedDocumentIds.clear();
    session.archivedDocumentIds.clear();
  }

  async function sweepSessions() {
    const now = Date.now();
    for (const session of sessions.values()) {
      const tooOld = now - session.createdAt >= MAX_SESSION_AGE_MS;
      const idle = !session.busy && now - session.lastActivityAt >= SESSION_IDLE_TTL_MS;
      if (tooOld || idle) await retireSession(session);
    }
  }

  const sessionSweep = setInterval(() => { void sweepSessions(); }, 60_000);
  sessionSweep.unref();

  async function reserveSessionSlot() {
    await sweepSessions();
    while (sessions.size + pendingSessionSlots >= MAX_SESSIONS) {
      const oldestIdle = [...sessions.values()].filter((session) => !session.busy)
        .sort((left, right) => left.lastActivityAt - right.lastActivityAt)[0];
      if (!oldestIdle) throw new SessionCapacityError("The reading server is at capacity. Try again after an active read finishes.");
      await retireSession(oldestIdle, "This reading session was removed to free server capacity.");
    }
    pendingSessionSlots += 1;
  }

  function trackAgent(session: ReadSession) {
    const scanToolCalls = new Map<string, { documentId: string; page?: number }>();
    session.agent.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        const rawText = eventText(event.message);
        const text = rawText.length > MAX_AGENT_TEXT_CHARS ? `${rawText.slice(0, MAX_AGENT_TEXT_CHARS)}\n…[后续内容已截断]` : rawText;
        if (text) session.currentAssistantText = text;
        return;
      }
      if (event.type === "tool_execution_start") {
        const args = event.args as Record<string, unknown> | undefined;
        const documentId = typeof args?.documentId === "string" ? args.documentId : undefined;
        if ((event.toolName === "render_scan_page" || event.toolName === "save_scan_page_text") && documentId) {
          scanToolCalls.set(event.toolCallId, { documentId, ...(typeof args?.page === "number" ? { page: args.page } : {}) });
        }
        if (documentId) setDocument(session, documentId, { state: "reading" });
        const phase = event.toolName === "inspect_document" ? "detection"
          : event.toolName === "parse_document" ? "extraction"
            : event.toolName === "render_scan_page" || event.toolName === "save_scan_page_text" ? "scan-reading"
              : event.toolName === "load_document_skill" && args?.skill === "document-overview" ? "overview"
                : event.toolName === "search_document" ? "search" : "processing";
        emit(session, "progress", {
          phase,
          state: "active",
          ...(documentId ? { documentId, title: session.documents.find((item) => item.id === documentId)?.title } : {}),
          ...(typeof args?.page === "number" ? { page: args.page } : {}),
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        const details = toolDetails(event);
        if (event.toolName === "parse_document" && typeof details.documentId === "string") {
          const documentId = details.documentId;
          if (details.status === "error") {
            setDocument(session, documentId, { state: "failed", error: boundedErrorMessage(details.error ?? "Document parsing failed.") });
          } else if (details.status === "parsed") {
            session.parsedDocumentIds.add(documentId);
            setDocument(session, documentId, {
              state: "reading",
              ...(typeof details.pages === "number" ? { pages: details.pages } : {}),
            });
          }
        }
        if ((event.toolName === "render_scan_page" || event.toolName === "save_scan_page_text") && typeof details.documentId === "string") {
          emit(session, "progress", {
            phase: "scan-reading",
            state: event.isError ? "failed" : "complete",
            documentId: details.documentId,
            page: details.page,
          });
          scanToolCalls.delete(event.toolCallId);
        } else if (event.toolName === "render_scan_page" || event.toolName === "save_scan_page_text") {
          const scanCall = scanToolCalls.get(event.toolCallId);
          if (scanCall) emit(session, "progress", { phase: "scan-reading", state: event.isError ? "failed" : "complete", ...scanCall });
          scanToolCalls.delete(event.toolCallId);
        }
      }
    });
  }

  async function runInitialRead(session: ReadSession) {
    if (session.cancelled || session.terminated) return;
    session.busy = true;
    session.currentRun = "initial";
    session.currentAssistantText = "";
    emit(session, "progress", { phase: "detection", state: "active" });
    const selectedDocuments = session.documents.filter((document) => document.state !== "failed");
    if (selectedDocuments.length === 0) {
      finish(session, "failed", "initial");
      return;
    }
    const documentList = selectedDocuments.map((document, index) => `${index + 1}. ${document.title} (documentId: ${document.id})`).join("\n");
    try {
      await session.agent.prompt([
        "Read every selected PDF in the list below. Use the available tools to inspect, parse, and read scan pages, then load the document-overview skill and provide a concise overview.",
        "Keep the original selection order. Report individual files that fail and continue with successful files. Do not perform a consistency review.",
        "Cite factual statements with exact tokens in this format: [[cite:<document-id>:<page-number>]]. Use only IDs in this list and positive page numbers returned by document evidence.",
        "Selected files:", documentList,
      ].join("\n\n"));
      if (session.cancelled) {
        finish(session, "cancelled", "initial");
        return;
      }
      const overview = session.currentAssistantText;
      const successes = session.documents.filter((document) =>
        session.parsedDocumentIds.has(document.id) && session.archivedDocumentIds.has(document.id));
      for (const document of session.documents.filter((item) => item.state !== "failed" && !successes.some((success) => success.id === item.id))) {
        const reason = session.parsedDocumentIds.has(document.id)
          ? "The parsed document could not be archived."
          : "The Agent did not parse this selected document.";
        setDocument(session, document.id, { state: "failed", error: reason });
      }
      for (const document of successes) {
        setDocument(session, document.id, {
          state: "ready",
          sourceUrl: `/api/library/${document.id}/source`,
          markdownUrl: `/api/library/${document.id}/markdown`,
        });
      }
      if (overview) {
        session.overview = overview;
        emit(session, "overview", { text: overview });
      }
      emit(session, "progress", { phase: "overview", state: "complete" });
      finish(session, successes.length === 0 ? "failed" : successes.length < session.documents.length ? "partial" : "completed", "initial");
    } catch (error) {
      if (session.cancelled) {
        finish(session, "cancelled", "initial");
        return;
      }
      const message = boundedErrorMessage(error);
      emit(session, "error", { message, operation: "read" });
      for (const document of session.documents.filter((item) => item.state !== "failed")) {
        setDocument(session, document.id, { state: "failed", error: message });
      }
      finish(session, "failed", "initial");
    }
  }

  /**
   * The names the built-in skills already use.
   *
   * A user skill never replaces a built-in one: the built-in skills carry the
   * review procedure and the guard rails, and they are versioned in the
   * repository while a user skill is not. The list is read from what is
   * actually loaded, so a new built-in skill reserves its own name.
   */
  function builtinSkillNames(): Set<string> {
    return new Set(loadSkills().skills.map((skill) => skill.name));
  }

  app.get("/api/skills", async (_request, response) => {
    try {
      response.json({ skills: await listUserSkills(userSkillsDirectory) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unable to read the skills." });
    }
  });

  app.post("/api/skills/import", (request, response) => {
    const body = request.body as { content?: unknown };
    if (typeof body.content !== "string" || !body.content.trim()) {
      response.status(400).json({ error: "Paste the contents of a SKILL.md file." });
      return;
    }
    const imported = importUserSkill(body.content);
    if (!imported.ok) {
      response.status(400).json({ error: imported.error });
      return;
    }
    // The imported skill is parsed, not stored. It changes what the next
    // review does, so the user sees it in the editor first.
    response.json({ skill: imported.skill });
  });

  app.put("/api/skills/:name", async (request, response) => {
    const name = request.params.name;
    if (!name) {
      response.status(400).json({ error: "A skill needs a name." });
      return;
    }
    const body = request.body as { description?: unknown; body?: unknown };
    const description = typeof body.description === "string" ? body.description : "";
    const skillBody = typeof body.body === "string" ? body.body : "";
    const validation = validateUserSkill(
      { name, description, body: skillBody },
      builtinSkillNames(),
      { root: userSkillsDirectory },
    );
    if (!validation.ok) {
      response.status(validation.errors.some((error) => error.includes("内置 skill")) ? 409 : 400).json({
        error: validation.errors.join(" "),
        errors: validation.errors,
        warnings: validation.warnings,
      });
      return;
    }
    try {
      const skill = await writeUserSkill(userSkillsDirectory, name, { description, body: skillBody });
      response.json({ skill, warnings: validation.warnings });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unable to save the skill." });
    }
  });

  app.delete("/api/skills/:name", async (request, response) => {
    const name = request.params.name;
    if (!name) {
      response.status(400).json({ error: "A skill needs a name." });
      return;
    }
    try {
      const deleted = await deleteUserSkill(userSkillsDirectory, name);
      if (!deleted) {
        response.status(404).json({ error: `No skill named ${name}.` });
        return;
      }
      response.json({ deleted: true });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unable to delete the skill." });
    }
  });

  app.get("/api/library", async (_request, response) => {
    try {
      const documents = await listLibraryDocuments(libraryDirectory, database);
      response.json({ documents: documents.map((document) => ({
        ...document,
        sourceUrl: `/api/library/${document.id}/source`,
        markdownUrl: `/api/library/${document.id}/markdown`,
      })) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unable to read the library." });
    }
  });

  app.get("/api/library/:id/source", async (request, response) => {
    const { id } = request.params;
    if (!id || !documentIdPattern.test(id)) return response.status(404).json({ error: "Document not found." });
    try {
      const stored = getLibraryDocument(id, database);
      if (!stored) return response.status(404).json({ error: "Document not found." });
      const filePath = stored.sourcePath;
      await access(filePath);
      response.type("application/pdf").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
    } catch {
      response.status(404).json({ error: "Document not found." });
    }
  });

  app.get("/api/library/:id/markdown", async (request, response) => {
    const { id } = request.params;
    if (!id || !documentIdPattern.test(id)) return response.status(404).json({ error: "Document not found." });
    try {
      const stored = getLibraryDocument(id, database);
      if (!stored?.markdownPath) return response.status(404).json({ error: "Document not found." });
      const filePath = stored.markdownPath;
      await access(filePath);
      response.type("text/markdown; charset=utf-8").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
    } catch {
      response.status(404).json({ error: "Document not found." });
    }
  });

  app.get("/api/documents/:id/file", async (request, response) => {
    const { id } = request.params;
    if (!id || !documentIdPattern.test(id)) return response.status(404).json({ error: "Document not found." });
    const filePath = resolve(uploadDirectory, `${id}.pdf`);
    try {
      await access(filePath);
      response.type("application/pdf").sendFile(filePath, { headers: { "Cache-Control": "no-store" } });
    } catch {
      response.status(404).json({ error: "Document not found." });
    }
  });

  app.post("/api/read", (request, response, next) => {
    upload.array("documents[]", MAX_UPLOADS)(request, response, async (uploadError) => {
      const files = Array.isArray(request.files) ? request.files : [];
      if (uploadError) {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
        next(uploadError);
        return;
      }
      if (files.length === 0) {
        response.status(400).json({ error: "Please select at least one PDF." });
        return;
      }
      if (!isUploadSelectionWithinLimit(files, maxTotalUploadBytes)) {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
        response.status(413).json({ error: "Selected PDFs exceed the 100 MiB total upload limit for one reading session." });
        return;
      }

      let hasSessionReservation = false;
      try {
        const mainProfile = database.getModelProfile("main");
        const visionProfile = database.getModelProfile("vision");
        if (!options.agentFactory && (!mainProfile || !visionProfile)) {
          throw new CrossDocVisionModelConfigError("Configure both the main and vision models in Settings before reading documents.");
        }
        await mkdir(uploadDirectory, { recursive: true });
        await reserveSessionSlot();
        hasSessionReservation = true;
        const sources: ScopedDocument[] = [];
        const seenContent = new Set<string>();
        const duplicateByPath = new Map<string, DuplicateOf>();
        const rejectedByPath = new Map<string, string>();
        for (const file of files) {
          const signature = (await readFile(file.path)).subarray(0, 5).toString("ascii");
          if (signature !== "%PDF-") {
            // Invalid signatures stay in the visible session as per-file failures.
            rejectedByPath.set(file.path, "File does not have a valid PDF signature.");
            continue;
          }
          const title = cleanDisplayName(file.originalname);
          const sha256 = await contentHashOf(file.path);
          // The same file twice in one selection is one document, not two.
          if (sha256 && seenContent.has(sha256)) {
            rejectedByPath.set(file.path, "这份文件与本次选择中的另一份内容相同。");
            continue;
          }
          if (sha256) seenContent.add(sha256);
          const duplicate = await findDuplicateOf(file);
          if (duplicate) duplicateByPath.set(file.path, duplicate);
          sources.push({ id: randomUUID(), title, sourceName: title, path: file.path });
        }
        if (sources.length === 0) throw new Error("No valid PDF files were selected.");

        // Keep the UI order from multipart selection; rejected files are visible as per-file failures.
        const sourceByPath = new Map(sources.map((source) => [source.path, source]));
        const documents: ReadDocument[] = files.map((file) => {
          const source = sourceByPath.get(file.path) ?? { id: randomUUID(), title: cleanDisplayName(file.originalname) };
          const error = rejectedByPath.get(file.path);
          const duplicate = duplicateByPath.get(file.path);
          return {
            id: source.id,
            title: source.title,
            state: error ? "failed" : "waiting",
            ...(error ? { error } : {}),
            ...(duplicate ? { duplicateOf: duplicate } : {}),
          };
        });
        let session: ReadSession | undefined;
        const agent = await agentFactory({
          documents: sources,
          userSkillsRoot: userSkillsDirectory,
          ...(mainProfile ? { mainProfile } : {}),
          ...(visionProfile ? { visionProfile } : {}),
          onDocumentUpdated: async (document, source) => {
            await saveLibraryDocument(document, source.path, source.sourceName ?? source.title, libraryDirectory, database);
            session?.archivedDocumentIds.add(document.id);
          },
          onDocumentRejected: async (documentId, _source, reason) => {
            await rm(resolve(libraryDirectory, documentId), { recursive: true, force: true });
            session?.archivedDocumentIds.delete(documentId);
            session?.parsedDocumentIds.delete(documentId);
            if (session) setDocument(session, documentId, { state: "failed", error: reason });
          },
        });
        session = {
          id: randomUUID(), agent, documents,
          parsedDocumentIds: new Set(), archivedDocumentIds: new Set(), events: [], eventBytes: 0, nextEventId: 1,
          answers: [], listeners: new Set(), stagedPaths: files.map((file) => file.path),
          busy: false, cancelled: false, initialCompleted: false, terminated: false, questionCount: 0,
          createdAt: Date.now(), lastActivityAt: Date.now(), currentRun: null, currentAssistantText: "",
        };
        sessions.set(session.id, session);
        pendingSessionSlots -= 1;
        hasSessionReservation = false;
        trackAgent(session);
        for (const document of session.documents.filter((item) => item.state === "failed")) emit(session, "document", { ...document });
        response.status(202).json({ sessionId: session.id, documents: session.documents });
        void runInitialRead(session);
      } catch (error) {
        if (hasSessionReservation) pendingSessionSlots -= 1;
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
        const message = error instanceof Error ? error.message : "Unable to start document reading.";
        const status = error instanceof CrossDocVisionModelConfigError || error instanceof SessionCapacityError ? 503 : 400;
        response.status(status).json({ error: message });
      }
    });
  });

  app.get("/api/read/:sessionId/events", (request, response) => {
    const session = sessions.get(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Reading session not found." });
    response.status(200);
    response.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    const rawLastId = request.header("Last-Event-ID") ?? request.query.after;
    const parsedLastId = Number.parseInt(String(rawLastId ?? "0"), 10);
    let cursor = Number.isSafeInteger(parsedLastId) && parsedLastId >= 0 ? parsedLastId : 0;
    session.lastActivityAt = Date.now();
    const send = (event: ReadEvent) => {
      if (event.id <= cursor || response.writableEnded) return;
      cursor = event.id;
      response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const listener: Response = response;
    session.listeners.add(listener);
    const latestId = session.nextEventId - 1;
    const earliestId = session.events[0]?.id ?? session.nextEventId;
    if (cursor < earliestId - 1) {
      response.write(`event: error\ndata: ${JSON.stringify({ operation: "replay", message: "Earlier progress was compacted; current session state follows." })}\n\n`);
      const snapshot = (type: ReadEventType, data: Record<string, unknown>) => {
        if (latestId > 0) response.write(`id: ${latestId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      for (const document of session.documents) snapshot("document", { ...document });
      if (session.overview) snapshot("overview", { text: session.overview });
      for (const answer of session.answers) snapshot("answer", answer);
      if (session.lastDone) snapshot("done", session.lastDone);
      cursor = latestId;
    } else {
      for (const event of session.events) send(event);
    }
    const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(": keep-alive\n\n"); }, 20_000);
    response.on("close", () => {
      clearInterval(heartbeat);
      session.listeners.delete(listener);
    });
  });

  app.post("/api/read/:sessionId/questions", async (request, response) => {
    const session = sessions.get(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Reading session not found." });
    const question = typeof request.body?.question === "string" ? request.body.question.trim() : "";
    if (!question) return response.status(400).json({ error: "Enter a question first." });
    if (question.length > 4_000) return response.status(400).json({ error: "Question is too long (maximum 4,000 characters)." });
    if (session.cancelled || session.terminated) return response.status(409).json({ error: "This reading session was cancelled." });
    if (session.busy) return response.status(409).json({ error: "The agent is already working on this session." });
    if (session.questionCount >= MAX_QUESTIONS_PER_SESSION) return response.status(409).json({ error: `This session reached its ${MAX_QUESTIONS_PER_SESSION}-question limit. Start a new reading session to continue.` });
    const searchable = session.documents.filter((document) => document.state !== "failed");
    if (searchable.length === 0) return response.status(409).json({ error: "No selected document was parsed successfully." });
    session.busy = true;
    session.currentRun = "question";
    session.questionCount += 1;
    session.lastActivityAt = Date.now();
    session.currentAssistantText = "";
    emit(session, "progress", { phase: "answer", state: "active" });
    response.status(202).json({ accepted: true });
    try {
      const scope = searchable.map(({ id, title }) => `${title} (${id})`).join(", ");
      await session.agent.prompt([
        "Answer this follow-up about the documents already selected in this session.",
        `Available document IDs: ${scope}`,
        "Use search_document to find evidence before answering. Cite factual statements with [[cite:<document-id>:<page-number>]] using the exact IDs and pages returned by evidence.",
        `Question: ${question}`,
      ].join("\n"));
      if (session.cancelled) {
        emit(session, "error", { operation: "question", question, message: "追问已取消。" });
        emit(session, "progress", { phase: "answer", state: "cancelled" });
        finish(session, "cancelled", "question");
        return;
      }
      const answer = session.currentAssistantText || "Agent returned no answer text.";
      session.answers.push({ question, text: answer });
      if (session.answers.length > MAX_RETAINED_ANSWERS) session.answers.shift();
      emit(session, "answer", { question, text: answer });
      emit(session, "progress", { phase: "answer", state: "complete" });
      session.busy = false;
      session.currentRun = null;
    } catch (error) {
      if (session.cancelled) {
        emit(session, "error", { operation: "question", question, message: "追问已取消。" });
        emit(session, "progress", { phase: "answer", state: "cancelled" });
        finish(session, "cancelled", "question");
        return;
      }
      const message = boundedErrorMessage(error);
      emit(session, "error", { message, operation: "question", question });
      session.busy = false;
      session.currentRun = null;
    }
  });

  app.post("/api/read/:sessionId/cancel", async (request, response) => {
    const session = sessions.get(request.params.sessionId);
    if (!session) return response.status(404).json({ error: "Reading session not found." });
    if (!session.cancelled && !session.terminated) {
      const operation = session.currentRun ?? (session.initialCompleted ? "question" : "initial");
      session.cancelled = true;
      emit(session, "progress", { phase: "cancellation", state: "active" });
      session.agent.abort();
      if (!session.busy) {
        if (operation === "question") {
          emit(session, "error", { operation: "question", message: "追问已取消。" });
          emit(session, "progress", { phase: "answer", state: "cancelled" });
        }
        finish(session, "cancelled", operation);
      }
    }
    response.json({ cancelled: true });
  });

  /**
   * Runs one review and streams the agent's progress and the result as NDJSON.
   *
   * Both ways into a review — uploaded files and library documents — end here,
   * so they produce the same stream.
   */
  async function streamReview(sources: ScopedDocument[], response: Response): Promise<void> {
    const reviewId = randomUUID();
    const mainProfile = database.getModelProfile("main");
    const visionProfile = database.getModelProfile("vision");
    if (!mainProfile) {
      response.status(503).json({ error: "Configure the main model in Settings before running a consistency review." });
      return;
    }

    response.status(200);
    response.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
    const write = (payload: Record<string, unknown>) => {
      if (!response.writableEnded) response.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const result = await runConsistencyReview({
        documents: sources,
        userSkillsRoot: userSkillsDirectory,
        ...(options.agentFactory ? { agentFactory: options.agentFactory } : {}),
        models: modelCatalog,
        mainProfile,
        ...(visionProfile ? { visionProfile } : {}),
        onStage: (tool) => write({ type: "progress", stage: tool }),
        onDocumentUpdated: async (document, source) => {
          await saveLibraryDocument(document, source.path, source.sourceName ?? source.title, libraryDirectory, database);
        },
        onDocumentRejected: async (documentId, _source, reason) => {
          await rm(resolve(libraryDirectory, documentId), { recursive: true, force: true });
        },
      });

      await writeReviewArtifacts(result, resolve(reviewDirectory, reviewId));
      write(reviewResponseBody(result, reviewId));
    } catch (error) {
      write({ type: "error", error: error instanceof Error ? error.message : "Review failed." });
    } finally {
      if (!response.writableEnded) response.end();
    }
  }

  app.post("/api/review", (request, response, next) => {
    upload.array("documents", MAX_UPLOADS)(request, response, async (uploadError) => {
      const files = Array.isArray(request.files) ? request.files : [];
      if (uploadError) {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
        next(uploadError);
        return;
      }
      if (files.length === 0) {
        response.status(400).json({ error: "Please upload at least one PDF." });
        return;
      }
      try {
        const mainProfile = database.getModelProfile("main");
        if (!mainProfile) {
          response.status(503).json({ error: "Configure the main model in Settings before running a consistency review." });
          return;
        }

        // The review procedure lives in .agents/skills/consistency-review. The agent
        // reads it and drives the tools; this route only collects what the tools returned
        // and streams the agent's real progress.
        const sources: ScopedDocument[] = [];
        const seenContent = new Set<string>();
        for (const file of files) {
          const title = cleanDisplayName(file.originalname);
          const sha256 = await contentHashOf(file.path);
          // The same file twice in one selection is one document, not two.
          if (sha256 && seenContent.has(sha256)) continue;
          if (sha256) seenContent.add(sha256);
          sources.push({ id: randomUUID(), title, sourceName: title, path: file.path });
        }
        if (sources.length === 0) {
          response.status(400).json({ error: "The selected files are identical; upload at least two different documents." });
          return;
        }

        await streamReview(sources, response);
      } catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : "Review failed." });
      } finally {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
      }
    });
  });

  // A review started from the library reuses the archived source files, so the
  // documents do not have to be uploaded again.
  app.post("/api/review/from-library", async (request, response) => {
    const body = request.body as { documentIds?: unknown };
    const ids = Array.isArray(body.documentIds)
      ? body.documentIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (ids.length === 0) {
      response.status(400).json({ error: "Select at least one document from the library." });
      return;
    }
    const sources: ScopedDocument[] = [];
    for (const id of ids) {
      const stored = getLibraryDocument(id, database);
      if (!stored) {
        response.status(404).json({ error: `Document ${id} is not in the library.` });
        return;
      }
      sources.push({
        id: stored.entry.id,
        title: stored.entry.title,
        sourceName: stored.entry.sourceName,
        path: stored.sourcePath,
      });
    }
    const mainProfile = database.getModelProfile("main");
    if (!mainProfile) {
      response.status(503).json({ error: "Configure the main model in Settings before running a consistency review." });
      return;
    }
    try {
      await streamReview(sources, response);
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Review failed." });
    }
  });

  app.get("/api/reviews", async (_request, response) => {
    const reviews = await listReviewArtifacts(reviewDirectory);
    response.json({ reviews });
  });

  app.get("/api/reviews/:id", async (request, response) => {
    const result = await readReviewArtifact(reviewDirectory, request.params.id);
    if (!result) {
      response.status(404).json({ error: "That review is no longer stored." });
      return;
    }
    response.json(reviewResponseBody(result, request.params.id));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    response.status(400).json({ error: error instanceof Error ? error.message : "Request failed." });
  });

  return app;
}

export function listenWebApp(app: Express, listenPort = port) {
  return app.listen(listenPort, LOCAL_BIND_HOST);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = createWebApp();
  const server = listenWebApp(app, port);
  server.once("listening", async () => {
    await mkdir(resolve(".crossdoc/uploads"), { recursive: true });
    console.log(`CrossDoc Web UI: http://localhost:${port}`);
  });
}
