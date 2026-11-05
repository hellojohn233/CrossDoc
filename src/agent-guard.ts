import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

/**
 * How many times each tool may run inside one agent run.
 *
 * Reading tools are allowed to repeat: an agent may legitimately inspect the
 * same document again or search several times. The review tools are not: they
 * each produce one result, and calling them again can only produce the same
 * result, which is how a review run ends up looping forever.
 */
export const TOOL_CALL_LIMITS: Readonly<Record<string, number>> = {
  load_document_skill: 12,
  inspect_document: 12,
  parse_document: 8,
  render_scan_page: 80,
  save_scan_page_text: 20,
  search_document: 12,
  list_key_vocabulary: 3,
  align_key_data: 3,
  verify_conflicts: 3,
  report_conflicts: 2,
};

/** The hard ceiling on tool calls in one agent run. */
export const DEFAULT_MAX_TOOL_CALLS = 150;

export interface ToolCallGuard {
  beforeToolCall: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
  /** How many times each tool has run. */
  counts: () => Record<string, number>;
  /** How many tool calls have run in total. */
  total: () => number;
}

export interface ToolCallGuardOptions {
  limits?: Readonly<Record<string, number>>;
  maxCalls?: number;
}

/**
 * Stops an agent from calling the same tool over and over.
 *
 * A blocked call is reported back to the model as a tool error that says what
 * to do instead, and the run is asked to end. The review result is computed
 * from what the tools already returned, so an early stop costs the run
 * nothing but a final sentence of prose.
 */
export function createToolCallGuard(options: ToolCallGuardOptions = {}): ToolCallGuard {
  const limits = options.limits ?? TOOL_CALL_LIMITS;
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const counts = new Map<string, number>();
  let total = 0;

  return {
    async beforeToolCall(context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> {
      const name = context.toolCall.name;
      total += 1;
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);

      if (total > maxCalls) {
        return {
          block: true,
          terminate: true,
          reason: `This run already used ${maxCalls} tool calls. Stop calling tools and give the final answer now.`,
        };
      }

      const limit = limits[name];
      if (limit !== undefined && count > limit) {
        return {
          block: true,
          terminate: true,
          reason: `You already called ${name} ${count - 1} time(s) in this run, which is the limit. Its result will not change. Stop calling tools and give the final answer now.`,
        };
      }

      return undefined;
    },
    counts() {
      return Object.fromEntries(counts);
    },
    total() {
      return total;
    },
  };
}
