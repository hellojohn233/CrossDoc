import type { ParsedDocument } from "../core/claims.js";
import { formatSourceLocation } from "./source-location.js";

function markdownLabel(value: string): string {
  return value.replaceAll("\n", " ").replaceAll("]", "\\]");
}

/** Render the normalized document while retaining a footnote for every positioned text block. */
export function renderDocumentMarkdown(document: Omit<ParsedDocument, "markdown">): string {
  const sourceNotes: string[] = [];
  let sourceIndex = 0;
  const pageMarkdown = document.pages.map((page) => {
    let cursor = 0;
    let body = "";

    for (const block of page.blocks) {
      if (block.start < cursor) continue;
      body += page.text.slice(cursor, block.start);
      body += `${block.text}[^src-${sourceIndex + 1}]`;
      cursor = block.end;
      sourceIndex += 1;
      sourceNotes.push(
        `[^src-${sourceIndex}]: ${markdownLabel(document.title)}, ${formatSourceLocation(block.source)}`,
      );
    }

    body += page.text.slice(cursor);
    return [`## Page ${page.page}`, "", body.trim(), ""].join("\n");
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
