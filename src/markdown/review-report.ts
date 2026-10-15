import type { Conflict, ReviewResult } from "../core/types.js";
import { formatSourceLocation } from "./source-location.js";

function evidenceLocation(evidence: Conflict["evidence"][number]): string {
  const locations = [...new Set(evidence.sourceBlocks.map((source) => formatSourceLocation(source.location)))];
  return locations.length > 0 ? locations.join("; ") : evidence.page === undefined ? "location unavailable" : `page ${evidence.page}`;
}

function renderConflict(conflict: Conflict, citationIds: Map<string, string>): string {
  const evidence = conflict.evidence
    .map(
      (item) =>
        `- [^${citationIds.get(item.id) ?? "source"}] ${evidenceLocation(item)}: "${item.quote.replaceAll("\n", " ").slice(0, 280)}"`,
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

export function renderReviewReport(result: Omit<ReviewResult, "reportMarkdown">): string {
  const verified = result.conflicts.filter((conflict) => conflict.status === "verified");
  const documentTitles = new Map(result.documents.map((document) => [document.id, document.title]));
  const sources = new Map<string, (typeof result.conflicts)[number]["evidence"][number]>();
  for (const conflict of result.conflicts) {
    for (const evidence of conflict.evidence) sources.set(evidence.id, evidence);
  }
  const citationIds = new Map([...sources.keys()].map((id, index) => [id, `E${index + 1}`] as const));
  const sourceNotes = [...sources.entries()].map(([id, evidence]) => {
    const citationId = citationIds.get(id) ?? "source";
    const title = documentTitles.get(evidence.documentId) ?? evidence.documentId;
    return `[^${citationId}]: ${title}, ${evidenceLocation(evidence)} — ${evidence.quote.replaceAll("\n", " ").slice(0, 280)}`;
  });

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
    result.conflicts.length > 0 ? result.conflicts.map((conflict) => renderConflict(conflict, citationIds)).join("\n\n") : "No conflicts found.",
    "",
    "## Sources",
    "",
    sourceNotes.length > 0 ? sourceNotes.join("\n") : "No sources captured.",
    "",
  ].join("\n");
}
