import type { AlignedPair } from "../core/key-data.js";
import type { ConflictJudgment, ConflictSeverity } from "../core/types.js";

const HIGH_IMPACT_KEYS = new Set([
  "contract_value",
  "currency",
  "payment_term",
  "effective_date",
  "expiry_date",
  "contract_subject",
  "liability_cap",
  "late_fee",
]);

/**
 * Degraded adjudicator used when no language model is configured or the model call failed.
 *
 * Two documents that state different values for the same key disagree, but the rule
 * pass cannot tell a genuine contradiction from a legitimate difference in scope,
 * so it never claims more than a medium severity.
 */
export function ruleAdjudicatePairs(pairs: AlignedPair[]): ConflictJudgment[] {
  return pairs.map((pair) => {
    const severity: ConflictSeverity = HIGH_IMPACT_KEYS.has(pair.key) ? "medium" : "low";
    return {
      candidateId: pair.id,
      conflict: true,
      severity,
      confidence: 0.6,
      summary: `${pair.label} 不一致`,
      rationale: `${pair.left.documentId} states "${pair.left.value}" while ${pair.right.documentId} states "${pair.right.value}"; no language model was available to confirm the scope.`,
    };
  });
}
