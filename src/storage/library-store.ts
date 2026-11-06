import { copyFile, mkdir, writeFile } from "node:fs/promises";
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
