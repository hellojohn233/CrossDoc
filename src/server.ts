import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";

import { createBuiltinModels, createCrossDocAgent, CrossDocVisionModelConfigError, type CrossDocAgentOptions, type ScopedDocument } from "./agent.js";
import { reviewDocuments } from "./review.js";
import { getLibraryDocument, listLibraryDocuments, saveLibraryDocument } from "./storage/library-store.js";
import { LocalDatabase, type ModelProfile, type ModelRole } from "./storage/database.js";
import { writeReviewArtifacts } from "./storage/review-store.js";

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

export function isUploadSelectionWithinLimit(files: readonly { size: number }[], maximumBytes = MAX_TOTAL_UPLOAD_SIZE): boolean {
  return files.reduce((total, file) => total + file.size, 0) <= maximumBytes;
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
  agentFactory?: (options: CrossDocAgentOptions) => Promise<Agent>;
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
  const modelCatalog = createBuiltinModels();
  const reviewDirectory = resolve(options.reviewDirectory ?? ".crossdoc/reviews");
  const pdfjsDirectory = resolve(options.pdfjsDirectory ?? "node_modules/pdfjs-dist/build");
  const maxTotalUploadBytes = options.maxTotalUploadBytes ?? MAX_TOTAL_UPLOAD_SIZE;
  const agentFactory = options.agentFactory ?? createCrossDocAgent;
  const sessions = new Map<string, ReadSession>();
  let pendingSessionSlots = 0;
  let totalEventBytes = 0;

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

  const publicModelProfile = (role: ModelRole) => {
    const profile = database.getModelProfile(role);
    if (!profile) return null;
    return {
      role,
      provider: profile.provider,
      modelId: profile.modelId,
      baseUrl: profile.baseUrl ?? "",
      options: profile.options ?? {},
      apiKeyConfigured: Boolean(profile.apiKey),
    };
  };

  app.get("/api/settings", (_request, response) => {
    response.json({ models: { main: publicModelProfile("main"), vision: publicModelProfile("vision") }, preferences: {} });
  });

  app.put("/api/settings/models/:role", (request, response) => {
    const role = request.params.role;
    if (role !== "main" && role !== "vision") return response.status(404).json({ error: "Unknown model role." });
    const body = request.body as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!provider || !modelId) return response.status(400).json({ error: "Provider and model ID are required." });
    const model = modelCatalog.getModel(provider, modelId);
    if (!model) return response.status(400).json({ error: `Model ${provider}/${modelId} is not in Pi AI's model catalog.` });
    if (role === "vision" && !model.input.includes("image")) {
      return response.status(400).json({ error: `Model ${provider}/${modelId} does not accept images. Choose an image-capable vision model.` });
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
        modelId,
        ...(typeof body.baseUrl === "string" && body.baseUrl.trim() ? { baseUrl: body.baseUrl.trim() } : {}),
        ...(typeof body.apiKey === "string" && body.apiKey.trim() ? { apiKey: body.apiKey.trim() } : {}),
        ...(options === undefined ? {} : { options: options as Record<string, unknown> }),
      }, body.clearApiKey === true);
      response.json({ model: publicModelProfile(role) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Unable to save model settings." });
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
        for (const file of files) {
          const signature = (await readFile(file.path)).subarray(0, 5).toString("ascii");
          const title = cleanDisplayName(file.originalname);
          const source = { id: randomUUID(), title, sourceName: title, path: file.path };
          if (signature === "%PDF-") sources.push(source);
          // Invalid signatures stay in the visible session as per-file failures.
        }
        if (sources.length === 0) throw new Error("No valid PDF files were selected.");

        // Keep the UI order from multipart selection; rejected files are visible as per-file failures.
        const sourceByPath = new Map(sources.map((source) => [source.path, source]));
        const rejectedByPath = new Map(files
          .filter((file) => !sourceByPath.has(file.path))
          .map((file) => [file.path, "File does not have a valid PDF signature."]));
        const documents: ReadDocument[] = files.map((file) => {
          const source = sourceByPath.get(file.path) ?? { id: randomUUID(), title: cleanDisplayName(file.originalname) };
          const error = rejectedByPath.get(file.path);
          return { id: source.id, title: source.title, state: error ? "failed" : "waiting", ...(error ? { error } : {}) };
        });
        let session: ReadSession | undefined;
        const agent = await agentFactory({
          documents: sources,
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
        const reviewId = randomUUID();
        const result = await reviewDocuments(files.map((file) => file.path), {
          documents: files.map((file) => ({ id: file.filename.replace(/\.pdf$/i, ""), title: cleanDisplayName(file.originalname) })),
        });
        await writeReviewArtifacts(result, resolve(reviewDirectory, reviewId));
        await Promise.all(result.documents.map((document) => {
          const sourceFile = files.find((file) => file.filename === `${document.id}.pdf`);
          if (!sourceFile) throw new Error(`Uploaded source file missing for document ${document.id}.`);
          return saveLibraryDocument(document, sourceFile.path, cleanDisplayName(sourceFile.originalname), libraryDirectory, database);
        }));
        response.json({
          reviewId,
          documents: result.documents.map((document) => ({ id: document.id, title: document.title, pages: document.pages.length, format: document.format, markdown: document.markdown, warnings: document.warnings, sourceUrl: `/api/library/${document.id}/source` })),
          claimCount: result.claims.length,
          conflictCount: result.conflicts.length,
          verifiedConflictCount: result.conflicts.filter((conflict) => conflict.status === "verified").length,
          conflicts: result.conflicts,
          reportMarkdown: result.reportMarkdown,
        });
      } catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : "Review failed." });
      } finally {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
      }
    });
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
