/**
 * Checks that the archive can be emptied.
 *
 * Every read archives a document, and the archive keeps every upload. That
 * means the user eventually holds copies they no longer want, and the only
 * way out is to delete them. This checks that one archive and the whole
 * archive can be removed, that the index and the files go together, and that
 * an id that tries to point somewhere else removes nothing.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createWebApp, listenWebApp } from "../src/server.ts";
import { deleteLibraryDocument } from "../src/storage/library-store.ts";

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

const workspace = await mkdtemp(join(tmpdir(), "crossdoc-archive-delete-"));
const libraryDirectory = join(workspace, "library");
const dataDirectory = workspace;
const uploadDirectory = join(workspace, "uploads");

const app = createWebApp({
  publicDirectory: "public",
  libraryDirectory,
  dataDirectory,
  uploadDirectory,
});
const database = app.locals.database;

/**
 * Archives one document on disk and in the index.
 *
 * The same content can be archived several times; the copies differ by id.
 */
async function archiveDocument(id, title, content) {
  const entryDirectory = resolve(libraryDirectory, id);
  await mkdir(entryDirectory, { recursive: true });
  const sourcePath = resolve(entryDirectory, "source.pdf");
  const jsonPath = resolve(entryDirectory, "document.json");
  const markdownPath = resolve(entryDirectory, "document.md");
  await writeFile(sourcePath, content, "utf8");
  await writeFile(jsonPath, "{}\n", "utf8");
  await writeFile(markdownPath, "# markdown\n", "utf8");
  database.saveDocument({ id, title, sourceName: title, format: "pdf", pages: 1 }, sourcePath, jsonPath, markdownPath);
  return id;
}

const server = listenWebApp(app, 0);
await new Promise((resolve_) => server.once("listening", resolve_));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

// The server only accepts a UUID as an archive id, so the fixtures use real ones.
const archiveOne = "11111111-1111-4111-8111-111111111111";
const archiveTwo = "22222222-2222-4222-8222-222222222222";
const archiveThree = "33333333-3333-4333-8333-333333333333";

await archiveDocument(archiveOne, "合同a.pdf", "content-a");
await archiveDocument(archiveTwo, "合同b.pdf", "content-b");
await archiveDocument(archiveThree, "合同a.pdf", "content-a");

await check("归档列表给出每一份归档，包括内容相同的那几份", async () => {
  const response = await fetch(`${base}/api/library`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.documents.length, 3);
  const ids = data.documents.map((document) => document.id).sort();
  assert.deepEqual(ids, [archiveOne, archiveThree, archiveTwo].sort());
});

await check("删掉一份归档，目录和索引行一起消失", async () => {
  const response = await fetch(`${base}/api/library/${encodeURIComponent(archiveThree)}`, { method: "DELETE" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.deleted, true);
  assert.equal(database.getDocument(archiveThree), undefined);
  await assert.rejects(() => rm(resolve(libraryDirectory, archiveThree)));
  const listed = await (await fetch(`${base}/api/library`)).json();
  assert.equal(listed.documents.length, 2);
});

await check("删掉的归档，源文件端点也不再给出", async () => {
  const response = await fetch(`${base}/api/library/${encodeURIComponent(archiveThree)}/source`);
  assert.equal(response.status, 404);
});

await check("删一份不存在的归档是 404，不会动别的东西", async () => {
  const response = await fetch(`${base}/api/library/${encodeURIComponent("not-here")}`, { method: "DELETE" });
  assert.equal(response.status, 404);
  const listed = await (await fetch(`${base}/api/library`)).json();
  assert.equal(listed.documents.length, 2);
});

await check("一个想逃出归档目录的 id 什么也删不掉", async () => {
  const response = await fetch(`${base}/api/library/${encodeURIComponent("../../escape")}`, { method: "DELETE" });
  assert.equal(response.status, 404);
  const listed = await (await fetch(`${base}/api/library`)).json();
  assert.equal(listed.documents.length, 2);
});

await check("存储层同样拒绝越界的 id", async () => {
  const deleted = await deleteLibraryDocument("../../escape", libraryDirectory, database);
  assert.equal(deleted, false);
});

await check("清空归档，目录和索引都空了", async () => {
  const response = await fetch(`${base}/api/library`, { method: "DELETE" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.removed, 2);
  assert.equal(database.listDocuments().length, 0);
  const listed = await (await fetch(`${base}/api/library`)).json();
  assert.deepEqual(listed.documents, []);
  await assert.rejects(() => rm(resolve(libraryDirectory, archiveOne)));
});

await check("清空之后，剩下的归档也取不到了", async () => {
  const response = await fetch(`${base}/api/library/${encodeURIComponent(archiveOne)}/source`);
  assert.equal(response.status, 404);
});

await check("清空一个已经空的归档是安全的", async () => {
  const response = await fetch(`${base}/api/library`, { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).removed, 0);
});

server.close();
await rm(workspace, { recursive: true, force: true });

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
