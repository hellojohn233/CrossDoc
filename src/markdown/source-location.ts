import type { SourceLocation } from "../core/claims.js";

/** Tolerance for treating a text box as the whole visible page. */
const PAGE_LEVEL_TOLERANCE = 0.01;

export function formatSourceLocation(location: SourceLocation): string {
  switch (location.type) {
    case "pdf": {
      // Vision-read lines carry the page rectangle, not a text box. Report the
      // page instead of a bounding box that does not describe any text.
      const isPageLevel = location.bbox.every(
        (value, index) => Math.abs(value - (location.pageBounds[index] ?? 0)) < PAGE_LEVEL_TOLERANCE,
      );
      return isPageLevel
        ? `page ${location.page}`
        : `page ${location.page}, bbox ${location.bbox.map((value) => value.toFixed(2)).join(", ")}`;
    }
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
