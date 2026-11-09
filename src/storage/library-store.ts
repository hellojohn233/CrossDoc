import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

/**
 * Removes one archived document: its directory and its index row.
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
  if (!activeDatabase.getDocument(id)) return false;
  await rm(entryDirectory, { recursive: true, force: true });
  activeDatabase.deleteDocument(id);
  return true;
}

/**
 * Removes every archived document.
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
    await rm(resolve(root, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  // The index is emptied as a whole, so a stray row without a directory
  // cannot survive the cleanup.
  activeDatabase.deleteAllDocuments();
  return removed;
}
