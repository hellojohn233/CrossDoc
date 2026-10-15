import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractTextItems, getDocumentProxy } from "unpdf";

import type { DocumentBlock, ParsedDocument, ParsedPage, PdfSourceLocation } from "../core/claims.js";
import { renderDocumentMarkdown } from "../markdown/document.js";
import type { DocumentLoader, ParseDocumentOptions } from "./types.js";

const MIN_NATIVE_TEXT_CHARACTERS = 8;
const MIN_NATIVE_TEXT_AREA_RATIO = 0.001;
const CONTENT_OPERATORS = new Set<number>([
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
  OPS.fill,
  OPS.eoFill,
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
  OPS.shadingFill,
]);

type PdfPageClassification = NonNullable<ParsedPage["classification"]>;

function hasMeaningfulText(text: string, textAreaRatio: number): boolean {
  const characterCount = text.replace(/\s/gu, "").length;
  return characterCount >= MIN_NATIVE_TEXT_CHARACTERS || textAreaRatio >= MIN_NATIVE_TEXT_AREA_RATIO;
}

function hasVisiblePageContent(operatorFunctions: number[], operatorArguments: unknown[][]): boolean {
  return operatorFunctions.some((operator, index) => {
    if (CONTENT_OPERATORS.has(operator)) return true;
    if (operator !== OPS.constructPath) return false;

    const [paintOperator] = operatorArguments[index] ?? [];
    return typeof paintOperator === "number" && CONTENT_OPERATORS.has(paintOperator);
  });
}

function classifyPage(text: string, textAreaRatio: number, hasVisibleContent: boolean): PdfPageClassification {
  if (hasMeaningfulText(text, textAreaRatio)) return "text-native";
  return hasVisibleContent ? "scan-candidate" : "blank-unknown";
}

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
      let textArea = 0;

      for (const [itemIndex, item] of pageItems.entries()) {
        const start = pageText.length;
        pageText += item.str;
        const end = pageText.length;
        const left = Math.min(item.x, item.x + item.width);
        const bottom = Math.min(item.y, item.y + item.height);
        const right = Math.max(item.x, item.x + item.width);
        const top = Math.max(item.y, item.y + item.height);
        if (item.str.trim().length > 0) {
          textArea += Math.max(0, right - left) * Math.max(0, top - bottom);
        }
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

      const pageArea = Math.max(0, pageBounds[2] - pageBounds[0]) * Math.max(0, pageBounds[3] - pageBounds[1]);
      const textAreaRatio = pageArea > 0 ? textArea / pageArea : 0;
      const meaningfulText = hasMeaningfulText(pageText, textAreaRatio);
      let classification: PdfPageClassification;
      if (meaningfulText) {
        classification = "text-native";
      } else {
        const operatorList = await pageProxy.getOperatorList();
        classification = classifyPage(
          pageText,
          textAreaRatio,
          hasVisiblePageContent(operatorList.fnArray, operatorList.argsArray),
        );
      }
      pages.push({
        page: pageNumber,
        text: pageText,
        blocks: pageBlocks,
        pageBounds,
        classification,
        extractionMethod:
          classification === "text-native" ? "native-text" : classification === "scan-candidate" ? "pending-vision" : "none",
      });
    }

    const warnings = pages
      .filter((page) => page.classification === "scan-candidate")
      .map((page) => `Page ${page.page} contains visual content without meaningful selectable text and needs vision reading.`);
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
