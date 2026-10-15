import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ParsedDocument } from "../core/claims.js";

export interface LibraryEntry {
  id: string;
  title: string;
  sourceName: string;
  format: ParsedDocument["format"];
  pages: number;
  uploadedAt: string;
}

const defaultLibraryDirectory = resolve("data/library");

export async function saveLibraryDocument(
  document: ParsedDocument,
  sourcePath: string,
  sourceName: string,
  libraryDirectory = defaultLibraryDirectory,
): Promise<LibraryEntry> {
  const entryDirectory = resolve(libraryDirectory, document.id);
  await mkdir(entryDirectory, { recursive: true });
  await Promise.all([
    copyFile(sourcePath, resolve(entryDirectory, "source.pdf")),
    writeFile(resolve(entryDirectory, "document.md"), document.markdown, "utf8"),
  ]);

  const entry: LibraryEntry = {
    id: document.id,
    title: document.title,
    sourceName,
    format: document.format,
    pages: document.pages.length,
    uploadedAt: new Date().toISOString(),
  };
  await writeFile(resolve(entryDirectory, "metadata.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return entry;
}

export async function listLibraryDocuments(libraryDirectory = defaultLibraryDirectory): Promise<LibraryEntry[]> {
  await mkdir(libraryDirectory, { recursive: true });
  const directories = await readdir(libraryDirectory, { withFileTypes: true });
  const entries = await Promise.all(
    directories
      .filter((directory) => directory.isDirectory())
      .map(async (directory) => {
        try {
          const contents = await readFile(resolve(libraryDirectory, directory.name, "metadata.json"), "utf8");
          return JSON.parse(contents) as LibraryEntry;
        } catch {
          return null;
        }
      }),
  );
  return entries
    .filter((entry): entry is LibraryEntry => entry !== null)
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}
