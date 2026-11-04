import type { Claim, EvidenceSpan, ParsedDocument } from "./claims.js";
import type { AlignedPair, KeyDataItem } from "./key-data.js";

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

/** The semantic verdict for one aligned pair. */
export interface ConflictJudgment {
  candidateId: string;
  conflict: boolean;
  severity: ConflictSeverity;
  confidence: number;
  summary: string;
  rationale: string;
}

/** Verdict for one aligned pair, plus how the verdict was produced. */
export interface AdjudicationResult {
  judgments: ConflictJudgment[];
  source: JudgeSource;
  warning?: string;
}

/** Stage 3 of the review: turns aligned pairs into verdicts. */
export type Adjudicator = (pairs: AlignedPair[]) => Promise<AdjudicationResult>;

/** The key data one document states, plus how it was obtained. */
export interface KeyDataExtraction {
  items: KeyDataItem[];
  source: JudgeSource;
  warning?: string;
}

/**
 * The model-backed stages of the review. Both can fall back to a rule pass, in
 * which case they report it through `source` and `warning`.
 */
export interface ReviewModel {
  /** Stage 1: which key data points a document asserts. */
  extractKeyData: (document: ParsedDocument) => Promise<KeyDataExtraction>;
  /** Stage 3: whether two aligned values contradict. */
  adjudicate: Adjudicator;
}

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
