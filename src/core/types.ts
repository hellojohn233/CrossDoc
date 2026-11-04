import type { Claim, EvidenceSpan, ParsedDocument } from "./claims.js";

export type ConflictSeverity = "low" | "medium" | "high";
export type ConflictStatus = "candidate" | "verified" | "dismissed";
/** Which stage produced a verdict. */
export type JudgeSource = "model" | "rule";

export interface Conflict {
  id: string;
  status: ConflictStatus;
  severity: ConflictSeverity;
  summary: string;
  rationale: string;
  claims: [Claim, Claim];
  evidence: EvidenceSpan[];
  /** Adjudicator confidence that the pair really contradicts (0-1). Never a similarity score. */
  score: number;
  /** Absent on legacy stored reviews. */
  judgeSource?: JudgeSource;
}

/**
 * Cheap signals that make a claim pair worth a semantic look.
 * These describe *why* a pair was recalled, never whether it really conflicts.
 */
export type RecallSignal =
  | "opposite-polarity"
  | "different-number"
  | "different-date"
  | "different-amount"
  | "shared-overlap";

/** A recalled pair of claims awaiting an adjudication verdict. */
export interface CandidatePair {
  id: string;
  claims: [Claim, Claim];
  /** Recall score (0-1). Cheap heuristic, never a verdict. */
  recallScore: number;
  signals: RecallSignal[];
}

/** The semantic verdict for one candidate pair. */
export interface ConflictJudgment {
  candidateId: string;
  conflict: boolean;
  severity: ConflictSeverity;
  confidence: number;
  summary: string;
  rationale: string;
}

/** Verdicts for a batch of recalled candidates, plus how they were produced. */
export interface AdjudicationResult {
  judgments: ConflictJudgment[];
  source: JudgeSource;
  warning?: string;
}

/** Stage 2 of the review: turns recalled candidates into verdicts. */
export type Adjudicator = (candidates: CandidatePair[]) => Promise<AdjudicationResult>;

export interface ReviewResult {
  documents: ParsedDocument[];
  claims: Claim[];
  conflicts: Conflict[];
  reportMarkdown: string;
  /** Which stage produced the verdicts in this review. */
  judgeSource?: JudgeSource;
  /** Human-readable note about a degraded or failed adjudication stage. */
  warning?: string;
}
