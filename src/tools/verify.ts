import type { EvidenceSpan, ParsedDocument } from "../core/claims.js";
import type { AlignedPair } from "../core/key-data.js";
import type { Conflict, ConflictJudgment, JudgeSource } from "../core/types.js";
import { claimForItem } from "./key-data.js";

export interface VerifyOptions {
  judgeSource?: JudgeSource;
  /** Parsed documents, used to trace a quote back to its source blocks. */
  documents?: Map<string, ParsedDocument>;
}

/**
 * Stage 4 of the review: turn verdicts on aligned pairs into conflicts, and check
 * that every conflict still carries citable evidence.
 *
 * A conflict whose evidence does not point back at its own document is dismissed:
 * an uncitable finding is worse than a missing one.
 */
export function verifyConflicts(
  pairs: AlignedPair[],
  judgments: ConflictJudgment[],
  options: VerifyOptions = {},
): Conflict[] {
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
  const conflicts: Conflict[] = [];

  for (const judgment of judgments) {
    const pair = pairById.get(judgment.candidateId);
    if (!pair) continue;

    const left = claimForItem(pair.left, options.documents?.get(pair.left.documentId));
    const right = claimForItem(pair.right, options.documents?.get(pair.right.documentId));
    const evidence = [left.evidence[0], right.evidence[0]].filter((item): item is EvidenceSpan => Boolean(item));
    const evidenceProblem = evidenceProblemFor(left, right);
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
): string | undefined {
  for (const claim of [left, right]) {
    const evidence = claim.evidence[0];
    if (!evidence) return `Evidence for ${claim.documentId} is missing.`;
    if (!evidence.quote.trim()) return `Evidence for ${claim.documentId} has no quote.`;
    if (evidence.documentId !== claim.documentId) {
      return `Evidence for ${claim.documentId} points at ${evidence.documentId}.`;
    }
  }
  return undefined;
}
