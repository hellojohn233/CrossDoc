import { renderReviewReport } from "../markdown/review-report.js";
import type { ReviewResult } from "../core/types.js";

/** Compatibility entry point used by the CLI and Pi tool adapter. */
export function reportConflicts(result: Omit<ReviewResult, "reportMarkdown">): string {
  return renderReviewReport(result);
}
