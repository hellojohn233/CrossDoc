import type { SourceLocation } from "../core/claims.js";

export function formatSourceLocation(location: SourceLocation): string {
  switch (location.type) {
    case "pdf":
      return `page ${location.page}, bbox ${location.bbox.map((value) => value.toFixed(2)).join(", ")}`;
    case "docx": {
      if (location.paragraphIndex !== undefined) return `paragraph ${location.paragraphIndex + 1}`;
      if (location.tableIndex !== undefined) {
        return `table ${location.tableIndex + 1}, row ${(location.rowIndex ?? 0) + 1}, column ${(location.columnIndex ?? 0) + 1}`;
      }
      return "document location unavailable";
    }
    case "xlsx":
      return `${location.sheet}!${location.range}`;
    case "image":
      return `${location.page === undefined ? "image" : `page ${location.page}`}, bbox ${location.bbox.map((value) => value.toFixed(1)).join(", ")}`;
  }
}
