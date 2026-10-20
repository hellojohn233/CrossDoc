import type { ParsedDocument, SourceLocation } from "../core/claims.js";
import { formatSourceLocation } from "./source-location.js";

function markdownLabel(value: string): string {
  return value.replaceAll("\n", " ").replaceAll("]", "\\]");
}

/**
 * Identify a source position.
 *
 * Blocks that share a position share one source note. Text-native lines each
 * own their line box, while vision-read lines all point at the same page
 * bounds, so a scanned page is cited once instead of once per line.
 */
function sourceLocationKey(location: SourceLocation): string {
  switch (location.type) {
    case "pdf":
      return `pdf|${location.page}|${location.bbox.map((value) => value.toFixed(4)).join(",")}|${location.pageBounds.map((value) => value.toFixed(4)).join(",")}`;
    case "docx":
      return `docx|${location.paragraphIndex ?? ""}|${location.tableIndex ?? ""}|${location.rowIndex ?? ""}|${location.columnIndex ?? ""}|${location.textStart ?? ""}|${location.textEnd ?? ""}`;
    case "xlsx":
      return `xlsx|${location.sheet}|${location.range}`;
    case "image":
      return `image|${location.page ?? ""}|${location.bbox.map((value) => value.toFixed(4)).join(",")}|${location.imageBounds.map((value) => value.toFixed(4)).join(",")}`;
  }
}

/** Render the normalized document while retaining a footnote for every source position. */
export function renderDocumentMarkdown(document: Omit<ParsedDocument, "markdown">): string {
  const sourceNotes: string[] = [];
  const noteIdByLocation = new Map<string, string>();
  const pageMarkdown = document.pages.map((page) => {
    let cursor = 0;
    let body = "";

    for (const block of page.blocks) {
      if (block.start < cursor) continue;
      body += page.text.slice(cursor, block.start);
      const locationKey = sourceLocationKey(block.source);
      let noteId = noteIdByLocation.get(locationKey);
      if (!noteId) {
        noteId = `[^src-${sourceNotes.length + 1}]`;
        noteIdByLocation.set(locationKey, noteId);
        sourceNotes.push(
          `${noteId}: ${markdownLabel(document.title)}, ${formatSourceLocation(block.source)}`,
        );
      }
      body += `${block.text}${noteId}`;
      cursor = block.end;
    }

    body += page.text.slice(cursor);
    const pageLines = [`## Page ${page.page}`, ""];
    if (page.extractionMethod === "vision-text") {
      pageLines.push("> This page was read by the vision model; citations are page-level.", "");
    }
    pageLines.push(body.trim(), "");
    return pageLines.join("\n");
  });

  return [
    `# ${markdownLabel(document.title)}`,
    "",
    `Source format: ${document.format}`,
    "",
    ...(document.warnings.length > 0 ? [`> Parsing warnings: ${document.warnings.join(" ")}`, ""] : []),
    ...pageMarkdown,
    "## Sources",
    "",
    sourceNotes.length > 0 ? sourceNotes.join("\n") : "No positioned text blocks were extracted.",
    "",
  ].join("\n");
}
