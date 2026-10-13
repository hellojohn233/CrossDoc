import type { Conflict, ReviewResult } from "../core/types.js";

function renderConflict(conflict: Conflict): string {
  const evidence = conflict.evidence
    .map(
      (item) =>
        `- ${item.documentId}, page ${item.page}: "${item.quote.replaceAll("\n", " ").slice(0, 280)}"`,
    )
    .join("\n");

  return [
    `### ${conflict.id}: ${conflict.summary}`,
    "",
    `- Status: ${conflict.status}`,
    `- Severity: ${conflict.severity}`,
    `- Score: ${conflict.score.toFixed(2)}`,
    `- Rationale: ${conflict.rationale}`,
    "",
    "Evidence:",
    evidence || "- No evidence captured.",
  ].join("\n");
}

export function reportConflicts(result: Omit<ReviewResult, "reportMarkdown">): string {
  const verified = result.conflicts.filter((conflict) => conflict.status === "verified");

  return [
    "# CrossDoc Consistency Review",
    "",
    `Documents reviewed: ${result.documents.length}`,
    `Claims extracted: ${result.claims.length}`,
    `Verified conflicts: ${verified.length}`,
    `Candidate/dismissed conflicts: ${result.conflicts.length - verified.length}`,
    "",
    "## Findings",
    "",
    result.conflicts.length > 0 ? result.conflicts.map(renderConflict).join("\n\n") : "No conflicts found.",
    "",
  ].join("\n");
}
