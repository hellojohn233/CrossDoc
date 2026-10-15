import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { extractTextItems, getDocumentProxy } from "unpdf";

import type { DocumentBlock, ParsedDocument, ParsedPage, PdfSourceLocation } from "../core/claims.js";
import { renderDocumentMarkdown } from "../markdown/document.js";
import type { DocumentLoader, ParseDocumentOptions } from "./types.js";

function makeDocumentId(path: string): string {
  const safeName = basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
  const pathHash = createHash("sha256").update(resolve(path)).digest("hex").slice(0, 10);
  return `${safeName}-${pathHash}`;
}

export const pdfLoader: DocumentLoader = {
  format: "pdf",
  extensions: [".pdf"],
  async parse(path: string, options: ParseDocumentOptions = {}): Promise<ParsedDocument> {
    const buffer = await readFile(path);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { items } = await extractTextItems(pdf);
    const pages: ParsedPage[] = [];
    const blocks: DocumentBlock[] = [];

    for (const [pageIndex, pageItems] of items.entries()) {
      const pageNumber = pageIndex + 1;
      const pageProxy = await pdf.getPage(pageNumber);
      const view = pageProxy.view;
      const pageBounds: [number, number, number, number] = [
        view[0] ?? 0,
        view[1] ?? 0,
        view[2] ?? 0,
        view[3] ?? 0,
      ];
      let pageText = "";
      const pageBlocks: DocumentBlock[] = [];

      for (const [itemIndex, item] of pageItems.entries()) {
        const start = pageText.length;
        pageText += item.str;
        const end = pageText.length;
        const left = Math.min(item.x, item.x + item.width);
        const bottom = Math.min(item.y, item.y + item.height);
        const right = Math.max(item.x, item.x + item.width);
        const top = Math.max(item.y, item.y + item.height);
        const source: PdfSourceLocation = {
          type: "pdf",
          page: pageNumber,
          bbox: [left, bottom, right, top],
          pageBounds,
        };

        if (item.str.length > 0) {
          const block: DocumentBlock = {
            id: `${options.id ?? makeDocumentId(path)}:p${pageNumber}:b${itemIndex + 1}`,
            kind: "text",
            text: item.str,
            source,
            start,
            end,
          };
          pageBlocks.push(block);
          blocks.push(block);
        }

        if (item.hasEOL) pageText += "\n";
      }

      pages.push({ page: pageNumber, text: pageText, blocks: pageBlocks });
    }

    const warnings = pages
      .filter((page) => page.text.trim().length === 0)
      .map((page) => `Page ${page.page} has no selectable text; OCR is not enabled yet.`);
    const document: Omit<ParsedDocument, "markdown"> = {
      id: options.id ?? makeDocumentId(path),
      title: options.title ?? basename(path),
      format: "pdf",
      pages,
      blocks,
      text: pages.map((page) => page.text).join("\n\n"),
      warnings,
    };

    return { ...document, markdown: renderDocumentMarkdown(document) };
  },
};
