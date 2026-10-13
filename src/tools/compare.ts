import type { Claim } from "../core/claims.js";
import type { Conflict } from "../core/types.js";

const NEGATION_PATTERN = /\b(no|not|never|without|禁止|不得|不应|不会|无需|不能)\b/i;

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function hasOppositePolarity(left: Claim, right: Claim): boolean {
  return NEGATION_PATTERN.test(left.value) !== NEGATION_PATTERN.test(right.value);
}

export function compareClaims(claims: Claim[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (!left || !right) continue;
      if (left.documentId === right.documentId) continue;
      if (left.kind !== right.kind) continue;

      const overlap = overlapScore(left.normalizedValue, right.normalizedValue);
      const oppositePolarity = hasOppositePolarity(left, right);
      if (overlap < 0.35 && !oppositePolarity) continue;

      conflicts.push({
        id: `conflict-${conflicts.length + 1}`,
        status: "candidate",
        severity: oppositePolarity ? "high" : "medium",
        summary: `Potential ${left.kind} inconsistency between ${left.documentId} and ${right.documentId}`,
        rationale: oppositePolarity
          ? "Claims appear to discuss similar content with opposite polarity."
          : "Claims share enough surface evidence to require review.",
        claims: [left, right],
        evidence: [...left.evidence, ...right.evidence],
        score: Math.max(overlap, oppositePolarity ? 0.7 : 0),
      });
    }
  }

  return conflicts;
}
