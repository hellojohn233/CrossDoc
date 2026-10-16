import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalDatabase } from "../src/storage/database.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";
import { createWebApp, listenWebApp } from "../src/server.ts";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "crossdoc-storage-"));
  const v1DataDirectory = join(root, "v1-data");
  await mkdir(v1DataDirectory, { recursive: true });
  const v1 = new Database(join(v1DataDirectory, "crossdoc.sqlite"));
  v1.exec(`
    CREATE TABLE model_configs (
      role TEXT PRIMARY KEY CHECK (role IN ('main', 'vision')),
      provider TEXT NOT NULL, model_id TEXT NOT NULL, base_url TEXT, api_key TEXT,
      options_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
    INSERT INTO model_configs(role, provider, model_id, base_url, api_key, options_json, updated_at)
      VALUES ('main', 'openai', 'gpt-4', 'https://api.openai.com/v1', 'legacy-secret', '{}', '2026-01-01T00:00:00.000Z');
    INSERT INTO model_configs(role, provider, model_id, base_url, api_key, options_json, updated_at)
      VALUES ('vision', 'openai', 'gpt-4o', 'https://api.openai.com/v1', NULL, '{}', '2026-01-01T00:00:00.000Z');
    PRAGMA user_version = 1;
  `);
  v1.close();
  const migrated = new LocalDatabase(v1DataDirectory);
  assert.equal(Number(migrated.db.pragma("user_version", { simple: true })), 2);
  assert.deepEqual(migrated.getModelProfile("main"), {
    role: "main", provider: "openai", protocol: "catalog", modelId: "gpt-4",
    baseUrl: "https://api.openai.com/v1", apiKey: "legacy-secret", options: {},
  }, "v1 built-in model profile and credentials survive migration with legacy catalog protocol");
  assert.equal(migrated.getModelProfile("vision").apiKey, undefined, "v1 ambient-credential profile remains without a stored key");
  migrated.close();

  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "scripted-ambient-key";
  const ambientApp = createWebApp({
    dataDirectory: v1DataDirectory,
    libraryDirectory: join(v1DataDirectory, "library"),
    publicDirectory: join(process.cwd(), "public"),
  });
  const ambientServer = listenWebApp(ambientApp, 0);
  try {
    await new Promise((resolve) => ambientServer.once("listening", resolve));
    const address = ambientServer.address();
    const ambientSettings = await fetch(`http://127.0.0.1:${address.port}/api/settings`).then((response) => response.json());
    assert.equal(ambientSettings.models.vision.apiKeyConfigured, false);
    assert.equal(ambientSettings.models.vision.authAvailable, true, "settings reports non-secret Pi ambient auth availability for a migrated catalog profile");
    assert.equal(JSON.stringify(ambientSettings).includes("scripted-ambient-key"), false, "ambient credential is never echoed");
    ambientApp.locals.database.saveModelProfile({ role: "vision", provider: "missing-test-provider", protocol: "catalog", modelId: "vision-test" });
    const unavailableSettings = await fetch(`http://127.0.0.1:${address.port}/api/settings`).then((response) => response.json());
    assert.equal(unavailableSettings.models.vision.authAvailable, false, "catalog profiles without a stored or ambient credential remain incomplete");
  } finally {
    await new Promise((resolve) => ambientServer.close(resolve));
    ambientApp.locals.database.close();
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }

  const dataDirectory = join(root, "data");
  const libraryDirectory = join(dataDirectory, "library");
  const legacyId = "legacy-pdf-id";
  const legacyDirectory = join(libraryDirectory, legacyId);
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(join(legacyDirectory, "source.pdf"), "%PDF-legacy");
  await writeFile(join(legacyDirectory, "document.md"), "# Legacy");
  await writeFile(join(legacyDirectory, "metadata.json"), JSON.stringify({
    id: legacyId, title: "Legacy agreement", sourceName: "legacy.pdf", format: "pdf", pages: 3, uploadedAt: "2026-10-01T00:00:00.000Z",
  }));

  const database = new LocalDatabase(dataDirectory);
  const firstImport = database.listDocuments();
  assert.equal(firstImport.length, 1);
  assert.equal(firstImport[0].sourceName, "legacy.pdf");
  assert.equal(firstImport[0].documentJsonPath, null);
  database.close();
  const reopened = new LocalDatabase(dataDirectory);
  assert.equal(reopened.listDocuments().length, 1, "legacy metadata import is idempotent across startup");

  const sourcePath = join(root, "new.pdf");
  await writeFile(sourcePath, "%PDF-new-document");
  const parsed = {
    id: "new-pdf-id", title: "New agreement", format: "pdf", pages: [{ page: 1, text: "Hello", blocks: [] }],
    blocks: [], text: "Hello", markdown: "# New agreement\n\nHello", warnings: [],
  };
  const archived = await saveLibraryDocument(parsed, sourcePath, "new.pdf", libraryDirectory, reopened);
  assert.equal(archived.sourceName, "new.pdf");
  assert.ok(archived.documentJsonPath?.endsWith("document.json"));
  assert.equal(JSON.parse(await readFile(join(libraryDirectory, parsed.id, "document.json"), "utf8")).text, "Hello");
  assert.equal(reopened.getDocument(parsed.id)?.fileSize, Buffer.byteLength("%PDF-new-document"));
  assert.equal(reopened.getDocument(parsed.id)?.sha256.length, 64);

  const discoveryCalls = [];
  const app = createWebApp({
    dataDirectory, libraryDirectory, publicDirectory: join(process.cwd(), "public"),
    modelDiscoveryTimeoutMs: 20, modelDiscoveryMaxBytes: 256,
    modelDiscoveryFetch: async (url, init) => {
      discoveryCalls.push({ url: String(url), headers: new Headers(init?.headers) });
      if (String(url).includes("slow.invalid")) {
        return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true }));
      }
      if (String(url).includes("large.invalid")) return new Response(JSON.stringify({ data: [{ id: "x".repeat(300) }] }));
      if (String(url).includes("openai.invalid")) return Response.json({ data: [{ id: "gpt-alpha", name: "GPT Alpha" }, { id: "gpt-alpha" }] });
      if (String(url).includes("anthropic.invalid")) return Response.json({ data: [{ id: "claude-sonnet", display_name: "Claude Sonnet" }] });
      return Response.json({ models: [{ name: "models/gemini-flash", displayName: "Gemini Flash" }] });
    },
  });
  const server = listenWebApp(app, 0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(address.address, "127.0.0.1", "the local app listener binds loopback only");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initial = await fetch(`${baseUrl}/api/settings`).then((response) => response.json());
    assert.equal(initial.models.main, null);

    const discover = (protocol, baseUrl, apiKey = "discovery-only-key") => fetch(`${baseUrlForApi}/api/settings/models/discover`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "main", protocol, baseUrl, apiKey }),
    });
    const baseUrlForApi = baseUrl;
    const openAiModels = await discover("openai-completions", "https://openai.invalid/v1").then((response) => response.json());
    assert.deepEqual(openAiModels.models, [{ id: "gpt-alpha", name: "GPT Alpha" }]);
    const anthropicModels = await discover("anthropic-messages", "https://anthropic.invalid/v1").then((response) => response.json());
    assert.deepEqual(anthropicModels.models, [{ id: "claude-sonnet", name: "Claude Sonnet" }]);
    const geminiModels = await discover("google-generative-ai", "https://gemini.invalid/v1beta").then((response) => response.json());
    assert.deepEqual(geminiModels.models, [{ id: "gemini-flash", name: "Gemini Flash" }]);
    assert.equal(discoveryCalls[0].headers.get("authorization"), "Bearer discovery-only-key");
    assert.equal(discoveryCalls[1].headers.get("x-api-key"), "discovery-only-key");
    assert.equal(discoveryCalls[1].headers.get("anthropic-version"), "2023-06-01");
    assert.equal(discoveryCalls[2].headers.get("x-goog-api-key"), "discovery-only-key");
    assert.equal(reopened.getModelProfile("main"), undefined, "model discovery does not persist its API key or profile");
    const timedOutDiscovery = await discover("openai-completions", "https://slow.invalid/v1");
    assert.equal(timedOutDiscovery.status, 502);
    assert.match((await timedOutDiscovery.json()).error, /timed out/i);
    const oversizedDiscovery = await discover("openai-completions", "https://large.invalid/v1");
    assert.equal(oversizedDiscovery.status, 502);
    assert.match((await oversizedDiscovery.json()).error, /limit|large|bytes/i);

    for (const [role, protocol, modelId] of [
      ["main", "anthropic-messages", "manual-main-id"],
      ["vision", "google-generative-ai", "manual-vision-id"],
    ]) {
      const saved = await fetch(`${baseUrl}/api/settings/models/${role}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol, baseUrl: "https://custom.invalid/v1", modelId, apiKey: `${role}-custom-secret` }),
      });
      assert.equal(saved.status, 200, "custom model ID can be entered without discovery");
      assert.equal(reopened.getModelProfile(role).protocol, protocol);
      assert.equal(reopened.getModelProfile(role).baseUrl, "https://custom.invalid/v1");
      assert.equal(reopened.getModelProfile(role).modelId, modelId);
      assert.equal(reopened.getModelProfile(role).apiKey, `${role}-custom-secret`);
    }
    const preservedCustom = await fetch(`${baseUrl}/api/settings/models/main`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: "anthropic-messages", baseUrl: "https://custom.invalid/v1", modelId: "manual-main-id", apiKey: "" }),
    });
    assert.equal(preservedCustom.status, 200);
    assert.equal(reopened.getModelProfile("main").apiKey, "main-custom-secret", "empty custom-key update preserves the saved key");
    const clearCustom = await fetch(`${baseUrl}/api/settings/models/main`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: "anthropic-messages", baseUrl: "https://custom.invalid/v1", modelId: "manual-main-id", clearApiKey: true }),
    });
    assert.equal(clearCustom.status, 200);
    assert.equal(reopened.getModelProfile("main").apiKey, undefined, "explicit custom-key clear removes the saved key");

    const mainSave = await fetch(`${baseUrl}/api/settings/models/main`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", modelId: "gpt-4", apiKey: "main-secret", baseUrl: "https://proxy.invalid/v1" }),
    });
    assert.equal(mainSave.status, 200);
    assert.equal(JSON.stringify(await mainSave.json()).includes("main-secret"), false, "settings API never echoes secrets");
    assert.equal(reopened.getModelProfile("main")?.apiKey, "main-secret");

    const preserveKey = await fetch(`${baseUrl}/api/settings/models/main`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", modelId: "gpt-4", apiKey: "" }),
    });
    assert.equal(preserveKey.status, 200);
    assert.equal(reopened.getModelProfile("main")?.apiKey, "main-secret", "empty update preserves saved key");

    const badVision = await fetch(`${baseUrl}/api/settings/models/vision`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", modelId: "gpt-4", apiKey: "vision-secret" }),
    });
    assert.equal(badVision.status, 400, "vision role rejects text-only model");

    const visionSave = await fetch(`${baseUrl}/api/settings/models/vision`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", modelId: "gemini-2.5-flash", apiKey: "vision-secret" }),
    });
    assert.equal(visionSave.status, 200);
    const settings = await fetch(`${baseUrl}/api/settings`).then((response) => response.json());
    assert.equal(settings.models.main.apiKeyConfigured, true);
    assert.equal(settings.models.vision.apiKeyConfigured, true);
    assert.equal(JSON.stringify(settings).includes("vision-secret"), false);

    const cleared = await fetch(`${baseUrl}/api/settings/models/main`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", modelId: "gpt-4", clearApiKey: true }),
    });
    assert.equal(cleared.status, 200);
    assert.equal(reopened.getModelProfile("main")?.apiKey, undefined, "explicit clear removes saved key");

    const library = await fetch(`${baseUrl}/api/library`).then((response) => response.json());
    assert.deepEqual(library.documents.map((item) => item.id), [parsed.id, legacyId]);
  } finally {
    server.close();
    app.locals.database.close();
    reopened.close();
    await rm(root, { recursive: true, force: true });
  }
  console.log("Local SQLite storage and model settings checks passed (v1 profile migration with stored/ambient auth, idempotent metadata import, JSON archive, key privacy/preservation/clear, bounded model discovery, model role validation).");
}

await main();
