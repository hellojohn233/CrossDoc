import type { CandidatePair, ConflictJudgment, ConflictSeverity } from "../core/types.js";

/**
 * Degraded adjudicator used when no language model is configured or the model call failed.
 *
 * It can only catch explicit contradictions (different dates, amounts, numbers, or opposite
 * polarity). It never claims to understand paraphrases, so it stays conservative.
 */
export function ruleAdjudicate(candidates: CandidatePair[]): ConflictJudgment[] {
  return candidates.map((candidate) => {
    const [left, right] = candidate.claims;
    const signals = candidate.signals;
    const difference = signals.find(
      (signal) => signal === "opposite-polarity" || signal === "different-date" || signal === "different-amount" || signal === "different-number",
    );

    if (!difference) {
      return {
        candidateId: candidate.id,
        conflict: false,
        severity: "low",
        confidence: 0.4,
        summary: "",
        rationale: "No explicit contradiction was detected without a language model to judge the wording.",
      };
    }

    const severity: ConflictSeverity = difference === "opposite-polarity" ? "high" : "medium";
    return {
      candidateId: candidate.id,
      conflict: true,
      severity,
      confidence: difference === "different-number" ? 0.6 : 0.7,
      summary: `Conflict between ${left.documentId} and ${right.documentId}`,
      rationale: `The two statements differ in ${difference.replace(/-/g, " ")}; no language model was available to confirm the wording.`,
    };
  });
}
