import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type { ParsedDocument } from "../core/claims.js";
import { LocalDatabase, resolveDataPath, type StoredDocument } from "./database.js";

export interface LibraryEntry {
  id: string;
  title: string;
  sourceName: string;
  format: ParsedDocument["format"];
  pages: number;
  /** When the document was first archived. */
  uploadedAt: string;
  /** When the document was last archived or reviewed. */
  lastUsedAt: string;
  fileSize?: number;
  sha256?: string;
  sourcePath?: string;
  documentJsonPath?: string | null;
  markdownPath?: string | null;
}

const defaultLibraryDirectory = resolve("data/library");
const defaultDatabases = new Map<string, LocalDatabase>();

function databaseFor(dataDirectory: string): LocalDatabase {
  const root = resolve(dataDirectory);
  let database = defaultDatabases.get(root);
  if (!database) {
    database = new LocalDatabase(root);
    defaultDatabases.set(root, database);
  }
  return database;
}

function entryFromStored(document: StoredDocument): LibraryEntry {
  return {
    id: document.id,
    title: document.title,
    sourceName: document.sourceName,
    format: document.format as ParsedDocument["format"],
    pages: document.pages,
    uploadedAt: document.uploadedAt,
    lastUsedAt: document.lastUsedAt,
    fileSize: document.fileSize,
    sha256: document.sha256,
    sourcePath: document.sourcePath,
    documentJsonPath: document.documentJsonPath,
    markdownPath: document.markdownPath,
  };
}

export async function saveLibraryDocument(
  document: ParsedDocument,
  sourcePath: string,
  sourceName: string,
  libraryDirectory = defaultLibraryDirectory,
  database?: LocalDatabase,
): Promise<LibraryEntry> {
  const activeDatabase = database ?? databaseFor(dirname(libraryDirectory));
  const entryDirectory = resolve(libraryDirectory, document.id);
  await mkdir(entryDirectory, { recursive: true });
  const sourceTarget = resolve(entryDirectory, "source.pdf");
  const jsonTarget = resolve(entryDirectory, "document.json");
  const markdownTarget = resolve(entryDirectory, "document.md");
  await Promise.all([
    copyFile(sourcePath, sourceTarget),
    writeFile(jsonTarget, `${JSON.stringify(document, null, 2)}\n`, "utf8"),
    writeFile(markdownTarget, document.markdown, "utf8"),
  ]);

  const record = activeDatabase.saveDocument({
    id: document.id,
    title: document.title,
    sourceName,
    format: document.format,
    pages: document.pages.length,
  }, sourceTarget, jsonTarget, markdownTarget);
  const entry: LibraryEntry = entryFromStored(record);
  await writeFile(resolve(entryDirectory, "metadata.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return entry;
}

export async function listLibraryDocuments(
  libraryDirectory = defaultLibraryDirectory,
  database?: LocalDatabase,
): Promise<LibraryEntry[]> {
  await mkdir(libraryDirectory, { recursive: true });
  return (database ?? databaseFor(dirname(libraryDirectory))).listDocuments().map(entryFromStored);
}

export function getLibraryDocument(
  id: string,
  database?: LocalDatabase,
): { entry: LibraryEntry; sourcePath: string; markdownPath?: string; documentJsonPath?: string } | undefined {
  const activeDatabase = database ?? databaseFor(resolve("data"));
  const stored = activeDatabase.getDocument(id);
  if (!stored) return undefined;
  return {
    entry: entryFromStored(stored),
    sourcePath: resolveDataPath(activeDatabase.dataDirectory, stored.sourcePath),
    ...(stored.markdownPath ? { markdownPath: resolveDataPath(activeDatabase.dataDirectory, stored.markdownPath) } : {}),
    ...(stored.documentJsonPath ? { documentJsonPath: resolveDataPath(activeDatabase.dataDirectory, stored.documentJsonPath) } : {}),
  };
}

/** An archive id is a directory name, never a path. */
const archiveIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** A removed archive, kept so it can be brought back. */
export interface TrashedDocument {
  id: string;
  title: string;
  sourceName: string;
  format: string;
  pages: number;
  uploadedAt: string;
  lastUsedAt: string;
  fileSize: number;
  sha256: string;
  /** When the archive was thrown away. */
  deletedAt: string;
}

/** Where removed archives wait. */
function trashDirectory(libraryDirectory: string): string {
  return resolve(resolve(libraryDirectory), "..", "trash");
}

/** A path inside the data directory, the way the index stores it. */
function dataRelative(dataDirectory: string, absolutePath: string): string {
  return relative(dataDirectory, absolutePath).split(sep).join("/");
}

/**
 * Moves one archived document to the trash: its files move, its index row
 * goes away, and a note goes with it.
 *
 * The index and the files have to go together. A row without files would
 * offer a document that cannot be opened; files without a row would stay on
 * disk forever, because nothing else knows they are there.
 *
 * @returns whether an archive was there to remove
 */
export async function deleteLibraryDocument(
  id: string,
  libraryDirectory = defaultLibraryDirectory,
  database?: LocalDatabase,
): Promise<boolean> {
  if (!archiveIdPattern.test(id)) return false;
  const root = resolve(libraryDirectory);
  const entryDirectory = resolve(root, id);
  // The id is a directory name, so it cannot leave the library. The check
  // stays anyway: a caller that passes something else gets nothing.
  if (entryDirectory !== root && !entryDirectory.startsWith(`${root}/`)) return false;
  const activeDatabase = database ?? databaseFor(dirname(root));
  const stored = activeDatabase.getDocument(id);
  if (!stored) return false;
  const trashRoot = trashDirectory(root);
  await mkdir(trashRoot, { recursive: true });
  const trashEntry = resolve(trashRoot, id);
  await rm(trashEntry, { recursive: true, force: true });
  await rename(entryDirectory, trashEntry);
  await writeFile(
    resolve(trashEntry, "trash.json"),
    `${JSON.stringify({ ...stored, deletedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  activeDatabase.deleteDocument(id);
  return true;
}

/**
 * Moves every archived document to the trash.
 *
 * @returns how many archives were removed
 */
export async function clearLibraryDocuments(
  libraryDirectory = defaultLibraryDirectory,
  database?: LocalDatabase,
): Promise<number> {
  const root = resolve(libraryDirectory);
  const activeDatabase = database ?? databaseFor(dirname(root));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await deleteLibraryDocument(entry.name, root, activeDatabase)) removed += 1;
  }
  // The index is emptied as a whole, so a stray row without a directory
  // cannot survive the cleanup.
  activeDatabase.deleteAllDocuments();
  return removed;
}

/** Lists what is waiting in the trash, newest first. */
export async function listTrashedDocuments(libraryDirectory = defaultLibraryDirectory): Promise<TrashedDocument[]> {
  const trashRoot = trashDirectory(resolve(libraryDirectory));
  const entries = await readdir(trashRoot, { withFileTypes: true }).catch(() => []);
  const trashed: TrashedDocument[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const note = resolve(trashRoot, entry.name, "trash.json");
    const content = await readFile(note, "utf8").catch(() => "");
    if (!content) continue;
    try {
      const parsed = JSON.parse(content) as TrashedDocument;
      trashed.push({ ...parsed, id: entry.name });
    } catch {
      // A note that cannot be read is not something that can be restored.
    }
  }
  return trashed.sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)));
}

/**
 * Brings one archive back from the trash.
 *
 * The document keeps the moment it first arrived: it comes back as the same
 * document, not as a new upload.
 *
 * @returns whether there was something to bring back
 */
export async function restoreLibraryDocument(
  id: string,
  libraryDirectory = defaultLibraryDirectory,
  database?: LocalDatabase,
): Promise<boolean> {
  if (!archiveIdPattern.test(id)) return false;
  const root = resolve(libraryDirectory);
  const trashRoot = trashDirectory(root);
  const trashEntry = resolve(trashRoot, id);
  if (trashEntry !== trashRoot && !trashEntry.startsWith(`${trashRoot}/`)) return false;
  const content = await readFile(resolve(trashEntry, "trash.json"), "utf8").catch(() => "");
  if (!content) return false;
  const note = JSON.parse(content) as TrashedDocument;
  const activeDatabase = database ?? databaseFor(dirname(root));
  const entryDirectory = resolve(root, id);
  await mkdir(root, { recursive: true });
  await rm(entryDirectory, { recursive: true, force: true });
  await rename(trashEntry, entryDirectory);
  await rm(resolve(entryDirectory, "trash.json"), { force: true });
  const dataDirectory = activeDatabase.dataDirectory;
  activeDatabase.restoreDocument({
    id: note.id,
    title: note.title,
    sourceName: note.sourceName,
    format: note.format,
    pages: note.pages,
    uploadedAt: note.uploadedAt,
    lastUsedAt: note.lastUsedAt,
    fileSize: note.fileSize,
    sha256: note.sha256,
    sourcePath: dataRelative(dataDirectory, resolve(entryDirectory, "source.pdf")),
    documentJsonPath: dataRelative(dataDirectory, resolve(entryDirectory, "document.json")),
    markdownPath: dataRelative(dataDirectory, resolve(entryDirectory, "document.md")),
  });
  return true;
}

/**
 * Throws one archive away for good.
 *
 * @returns whether there was something in the trash
 */
export async function purgeTrashedDocument(
  id: string,
  libraryDirectory = defaultLibraryDirectory,
): Promise<boolean> {
  if (!archiveIdPattern.test(id)) return false;
  const trashRoot = trashDirectory(resolve(libraryDirectory));
  const trashEntry = resolve(trashRoot, id);
  if (trashEntry !== trashRoot && !trashEntry.startsWith(`${trashRoot}/`)) return false;
  const content = await readFile(resolve(trashEntry, "trash.json"), "utf8").catch(() => "");
  if (!content) return false;
  await rm(trashEntry, { recursive: true, force: true });
  return true;
}

/**
 * Throws the whole trash away for good.
 *
 * @returns how many archives were thrown away
 */
export async function clearTrash(libraryDirectory = defaultLibraryDirectory): Promise<number> {
  const trashRoot = trashDirectory(resolve(libraryDirectory));
  const entries = await readdir(trashRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(resolve(trashRoot, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
