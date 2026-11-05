import type { AlignedPair, KeyDataItem } from "../core/key-data.js";
import type { Conflict, ConflictJudgment } from "../core/types.js";

/**
 * What the review tools have produced so far inside one agent run.
 *
 * The tools live in one agent run, so the state lives with them: a tool that
 * needs the previous step's output reads it from here instead of asking the
 * model to repeat it. Asking the model to echo a large payload back is a
 * reliability problem, not a capability one.
 */
export interface ReviewSession {
  /** The key data items the agent submitted. */
  items: KeyDataItem[];
  /** The aligned pairs whose values differ. */
  pairs: AlignedPair[];
  /** The agent's verdicts on those pairs. */
  judgments: ConflictJudgment[];
  /** The conflicts that survived verification. */
  conflicts: Conflict[];
}

export function createReviewSession(): ReviewSession {
  return { items: [], pairs: [], judgments: [], conflicts: [] };
}
