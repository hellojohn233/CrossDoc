import type { AlignedPair } from "../core/key-data.js";
import type { ConflictJudgment, ConflictSeverity } from "../core/types.js";

/** Injected text completion. Keeps this module testable without a model runtime. */
export type CompleteFn = (prompt: string) => Promise<string>;

export interface AdjudicateOptions {
  complete: CompleteFn;
  /** How many aligned pairs to send in one request. */
  batchSize?: number;
  onProgress?: (completed: number, total: number) => void;
}

const SEVERITIES = new Set<ConflictSeverity>(["low", "medium", "high"]);

interface ParsedJudgment {
  conflict: boolean;
  severity: ConflictSeverity;
  confidence: number;
  summary: string;
  rationale: string;
}

export function buildAdjudicationPrompt(batch: AlignedPair[]): string {
  const payload = batch.map((pair) => ({
    id: pair.id,
    key: pair.key,
    label: pair.label,
    a: { document: pair.left.documentId, value: pair.left.value, quote: pair.left.quote },
    b: { document: pair.right.documentId, value: pair.right.value, quote: pair.right.quote },
    values: pair.group.map((item) => ({ document: item.documentId, value: item.value })),
  }));

  return [
    "You are checking whether key data lines up across a set of documents.",
    "Each candidate names one data point (a key) and shows the value two documents state for it.",
    "The values array lists what every document states for that key, so you can see which documents agree and which differ.",
    "",
    "Answer conflict=true only when the two values cannot both be right for the same subject and scope, for example:",
    "- the same key carries different numbers, dates, amounts, or durations;",
    "- the two documents bind different parties, jurisdictions, or named terms for the same key;",
    "- one document grants or excludes what the other grants or excludes.",
    "",
    "Answer conflict=false when:",
    "- the two values are the same thing written differently;",
    "- one value is more general or more specific than the other but stays compatible;",
    "- the two documents describe different subjects, parties, or obligations;",
    "- one document does not state this key at all, so there is nothing to contradict.",
    "",
    "Judge only from the values and quotes you are given. Never invent facts and never use outside knowledge.",
    "Answer in the language of the quotes.",
    "",
    "Candidates (JSON):",
    JSON.stringify(payload, null, 2),
    "",
    "Return ONLY a JSON array with one object per candidate, same order, no prose and no code fence:",
    '[{"id":"<candidate id>","conflict":true,"severity":"low|medium|high","confidence":0.0,"summary":"<=80 chars","rationale":"one sentence"}]',
    "",
    "severity: high = changes an amount, a deadline, or who is bound; medium = changes a material term; low = minor.",
  ].join("\n");
}

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|conflict)$/i.test(value.trim());
  return false;
}

function readText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

/** Tolerant JSON extraction: models often wrap answers in prose or code fences. */
export function parseAdjudicationResponse(raw: string): Map<string, ParsedJudgment> {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("The adjudicator did not return a JSON array.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new Error(`The adjudicator returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The adjudicator returned a JSON value that is not an array.");
  }

  const results = new Map<string, ParsedJudgment>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || results.has(id)) continue;
    const severityValue = typeof record.severity === "string" ? record.severity.trim().toLowerCase() : "";
    const confidenceValue = typeof record.confidence === "number" ? record.confidence : Number(record.confidence);
    results.set(id, {
      conflict: readBoolean(record.conflict),
      severity: SEVERITIES.has(severityValue as ConflictSeverity) ? (severityValue as ConflictSeverity) : "medium",
      confidence: Number.isFinite(confidenceValue) ? Math.min(1, Math.max(0, confidenceValue)) : 0.5,
      summary: readText(record.summary, 160),
      rationale: readText(record.rationale, 600),
    });
  }
  return results;
}

/**
 * Stage 3 of the review: ask a language model whether two aligned values contradict.
 *
 * Pairs are batched so a review costs a handful of requests instead of one per pair.
 * A pair the model omits is treated as consistent, never as a conflict.
 */
export async function adjudicatePairs(
  pairs: AlignedPair[],
  options: AdjudicateOptions,
): Promise<ConflictJudgment[]> {
  if (pairs.length === 0) return [];
  const batchSize = Math.max(1, options.batchSize ?? 8);
  const judgments: ConflictJudgment[] = [];

  for (let index = 0; index < pairs.length; index += batchSize) {
    const batch = pairs.slice(index, index + batchSize);
    const raw = await options.complete(buildAdjudicationPrompt(batch));
    const parsed = parseAdjudicationResponse(raw);

    for (const pair of batch) {
      const verdict = parsed.get(pair.id);
      judgments.push(
        verdict
          ? {
              candidateId: pair.id,
              conflict: verdict.conflict,
              severity: verdict.severity,
              confidence: verdict.confidence,
              summary: verdict.summary || `${pair.label} 不一致`,
              rationale: verdict.rationale || "The adjudicator reported a contradiction without a rationale.",
            }
          : {
              candidateId: pair.id,
              conflict: false,
              severity: "low",
              confidence: 0,
              summary: "",
              rationale: "The adjudicator returned no verdict for this pair, so it was not reported as a conflict.",
            },
      );
    }

    options.onProgress?.(Math.min(index + batchSize, pairs.length), pairs.length);
  }

  return judgments;
}
