import type { EvidenceSpan, ParsedDocument } from "../core/claims.js";
import type { AlignedPair } from "../core/key-data.js";
import type { Conflict, ConflictJudgment, ConflictSeverity, JudgeSource } from "../core/types.js";
import { claimForItem } from "./align.js";

export interface VerifyOptions {
  judgeSource?: JudgeSource;
  /** Parsed documents, used to trace a quote back to its source blocks and to its source text. */
  documents?: Map<string, ParsedDocument>;
}

const SEVERITIES: readonly ConflictSeverity[] = ["low", "medium", "high"];

/**
 * Normalizes one verdict the model produced.
 *
 * A verdict arrives as free-form model output, so every field can come back in
 * a shape the pipeline does not expect: confidence as a string or a percentage,
 * severity as a word the pipeline does not know, conflict as "yes" instead of
 * true. The pipeline is the boundary that turns that into a verdict it can
 * reason about, instead of trusting the shape.
 */
export function normalizeJudgment(raw: unknown): ConflictJudgment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const candidateId = firstString(value.candidateId, value.candidate_id);
  if (!candidateId) return undefined;

  const severity = SEVERITIES.includes(value.severity as ConflictSeverity)
    ? (value.severity as ConflictSeverity)
    : "medium";

  return {
    candidateId,
    conflict: toBoolean(value.conflict ?? value.isConflict),
    severity,
    confidence: toConfidence(value.confidence),
    summary: firstString(value.summary, value.title),
    rationale: firstString(value.rationale, value.reason),
  };
}

function firstString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "yes" || text === "conflict" || text === "1";
  }
  return false;
}

function toConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0.5;
  // A number above one is read as a percentage.
  if (parsed > 1) return Math.min(1, parsed / 100);
  return Math.max(0, parsed);
}

/**
 * Turn verdicts on aligned pairs into conflicts, and check that every conflict
 * still carries citable evidence.
 *
 * A conflict whose evidence does not point back at its own document is dismissed,
 * and a quote that is not found in the source text is dismissed as well: an
 * uncitable finding is worse than a missing one.
 */
export function verifyConflicts(
  pairs: AlignedPair[],
  judgments: ConflictJudgment[],
  options: VerifyOptions = {},
): Conflict[] {
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
  const conflicts: Conflict[] = [];

  for (const raw of judgments) {
    const judgment = normalizeJudgment(raw);
    if (!judgment) continue;
    const pair = pairById.get(judgment.candidateId);
    if (!pair) continue;

    const leftDocument = options.documents?.get(pair.left.documentId);
    const rightDocument = options.documents?.get(pair.right.documentId);
    const left = claimForItem(pair.left, leftDocument);
    const right = claimForItem(pair.right, rightDocument);
    const evidence = [left.evidence[0], right.evidence[0]].filter((item): item is EvidenceSpan => Boolean(item));
    const evidenceProblem = evidenceProblemFor(left, right, leftDocument, rightDocument);
    const accepted = judgment.conflict && !evidenceProblem;

    conflicts.push({
      id: pair.id.replace(/^pair-/, "conflict-"),
      status: accepted ? "verified" : "dismissed",
      severity: accepted ? judgment.severity : "low",
      summary: judgment.summary || `${pair.label} 不一致`,
      rationale: evidenceProblem ? `${judgment.rationale} ${evidenceProblem}` : judgment.rationale,
      claims: [left, right],
      evidence,
      score: judgment.confidence,
      ...(options.judgeSource ? { judgeSource: options.judgeSource } : {}),
    });
  }

  return conflicts;
}

function evidenceProblemFor(
  left: { documentId: string; evidence: { documentId: string; quote: string }[] },
  right: { documentId: string; evidence: { documentId: string; quote: string }[] },
  leftDocument: ParsedDocument | undefined,
  rightDocument: ParsedDocument | undefined,
): string | undefined {
  const documents = new Map([
    [left.documentId, leftDocument],
    [right.documentId, rightDocument],
  ]);
  for (const claim of [left, right]) {
    const evidence = claim.evidence[0];
    if (!evidence) return `Evidence for ${claim.documentId} is missing.`;
    if (!evidence.quote.trim()) return `Evidence for ${claim.documentId} has no quote.`;
    if (evidence.documentId !== claim.documentId) {
      return `Evidence for ${claim.documentId} points at ${evidence.documentId}.`;
    }
    const document = documents.get(claim.documentId);
    if (document && !quoteFoundInDocument(document, evidence.quote)) {
      return `The quote for ${claim.documentId} was not found in the source text.`;
    }
  }
  return undefined;
}

function quoteFoundInDocument(document: ParsedDocument, quote: string): boolean {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return false;
  const haystack = document.text.replace(/\s+/g, " ");
  return haystack.includes(needle);
}
