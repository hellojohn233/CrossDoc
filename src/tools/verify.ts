import type { EvidenceSpan } from "../core/claims.js";
import type { CandidatePair, Conflict, ConflictJudgment, JudgeSource } from "../core/types.js";

export interface VerifyOptions {
  judgeSource?: JudgeSource;
}

/**
 * Stage 3 of the review: turn adjudication verdicts into conflicts, and check that
 * every conflict still carries citable evidence.
 *
 * A conflict whose evidence does not point back at its own claim is dismissed:
 * an uncitable finding is worse than a missing one.
 */
export function verifyConflicts(
  candidates: CandidatePair[],
  judgments: ConflictJudgment[],
  options: VerifyOptions = {},
): Conflict[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const conflicts: Conflict[] = [];

  for (const judgment of judgments) {
    const candidate = candidateById.get(judgment.candidateId);
    if (!candidate) continue;

    const [left, right] = candidate.claims;
    const evidence = [left.evidence[0], right.evidence[0]].filter((item): item is EvidenceSpan => Boolean(item));
    const evidenceProblem = evidenceProblemFor(left, right);
    const accepted = judgment.conflict && !evidenceProblem;

    conflicts.push({
      id: candidate.id,
      status: accepted ? "verified" : "dismissed",
      severity: accepted ? judgment.severity : "low",
      summary: judgment.summary || `Conflict between ${left.documentId} and ${right.documentId}`,
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
  left: CandidatePair["claims"][number],
  right: CandidatePair["claims"][number],
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
