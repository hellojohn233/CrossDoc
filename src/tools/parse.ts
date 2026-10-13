import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

import type { ParsedDocument, ParsedPage } from "../core/claims.js";

function makeDocumentId(path: string): string {
  return basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function parseDoc(path: string): Promise<ParsedDocument> {
  const absolutePath = resolve(path);
  const buffer = await readFile(absolutePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [text];
  const pages: ParsedPage[] = pageTexts.map((pageText, index) => ({
    page: index + 1,
    text: pageText.trim(),
  }));

  return {
    id: makeDocumentId(absolutePath),
    path: absolutePath,
    title: basename(absolutePath),
    pages,
    text: pages.map((page) => page.text).join("\n\n"),
  };
}
