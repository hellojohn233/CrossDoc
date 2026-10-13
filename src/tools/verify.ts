import type { Conflict } from "../core/types.js";

export function verifyConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.map((conflict) => {
    if (conflict.score >= 0.7) {
      return {
        ...conflict,
        status: "verified",
        rationale: `${conflict.rationale} Verification passed the current conservative threshold.`,
      };
    }

    return {
      ...conflict,
      status: "dismissed",
      severity: "low",
      rationale: `${conflict.rationale} Verification dismissed it as too weak for the current threshold.`,
    };
  });
}
