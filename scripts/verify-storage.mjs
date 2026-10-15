import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalDatabase } from "../src/storage/database.ts";
import { saveLibraryDocument } from "../src/storage/library-store.ts";
import { createWebApp, listenWebApp } from "../src/server.ts";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "crossdoc-storage-"));
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

  const app = createWebApp({ dataDirectory, libraryDirectory, publicDirectory: join(process.cwd(), "public") });
  const server = listenWebApp(app, 0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(address.address, "127.0.0.1", "the local app listener binds loopback only");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initial = await fetch(`${baseUrl}/api/settings`).then((response) => response.json());
    assert.equal(initial.models.main, null);

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
  console.log("Local SQLite storage and model settings checks passed (versioned schema, idempotent metadata import, JSON archive, key privacy/preservation/clear, model role validation).");
}

await main();
