import type { Claim, EvidenceSpan, ParsedDocument } from "./claims.js";

export type ConflictSeverity = "low" | "medium" | "high";
export type ConflictStatus = "candidate" | "verified" | "dismissed";

export interface Conflict {
  id: string;
  status: ConflictStatus;
  severity: ConflictSeverity;
  summary: string;
  rationale: string;
  claims: [Claim, Claim];
  evidence: EvidenceSpan[];
  score: number;
}

export interface ReviewResult {
  documents: ParsedDocument[];
  claims: Claim[];
  conflicts: Conflict[];
  reportMarkdown: string;
}
