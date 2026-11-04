import type { CandidatePair, ConflictJudgment, ConflictSeverity } from "../core/types.js";

/** Injected text completion. Keeps this module testable without a model runtime. */
export type CompleteFn = (prompt: string) => Promise<string>;

export interface AdjudicateOptions {
  complete: CompleteFn;
  /** How many candidate pairs to send in one request. */
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

function quoteOf(claim: CandidatePair["claims"][number]): string {
  return claim.evidence[0]?.quote?.trim() || claim.value.trim();
}

export function buildAdjudicationPrompt(batch: CandidatePair[]): string {
  const payload = batch.map((pair) => ({
    id: pair.id,
    signals: pair.signals,
    a: { document: pair.claims[0].documentId, quote: quoteOf(pair.claims[0]) },
    b: { document: pair.claims[1].documentId, quote: quoteOf(pair.claims[1]) },
  }));

  return [
    "You are the semantic adjudicator of a multi-document consistency review.",
    "For each candidate pair, decide whether statement A and statement B CONTRADICT each other.",
    "",
    "A contradiction means the two statements cannot both be true for the same subject and scope, for example:",
    "- different numbers, dates, amounts, percentages, or durations for the same obligation;",
    "- opposite permissions or prohibitions (may vs must not);",
    "- different parties, jurisdictions, or named terms for the same clause;",
    "- one statement grants or excludes what the other grants or excludes.",
    "",
    "Not a contradiction: the statements agree, one is a more general or more specific version of the other,",
    "they talk about different subjects or obligations, or they merely restate the same clause in other words.",
    "",
    "Judge only from the quoted text. Never invent facts and never use outside knowledge.",
    "Answer in the language of the quotes.",
    "",
    "Candidates (JSON):",
    JSON.stringify(payload, null, 2),
    "",
    "Return ONLY a JSON array with one object per candidate, same order, no prose and no code fence:",
    '[{"id":"<candidate id>","conflict":true,"severity":"low|medium|high","confidence":0.0,"summary":"<=80 chars","rationale":"one sentence"}]',
    "",
    "severity: high = changes a legal or financial permission or obligation; medium = changes a material term; low = minor.",
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
 * Stage 2 of the review: ask a language model whether each recalled pair really contradicts.
 *
 * Pairs are batched so a review costs a handful of requests instead of one per pair.
 * A pair the model omits is treated as consistent, never as a conflict.
 */
export async function adjudicateCandidates(
  candidates: CandidatePair[],
  options: AdjudicateOptions,
): Promise<ConflictJudgment[]> {
  if (candidates.length === 0) return [];
  const batchSize = Math.max(1, options.batchSize ?? 8);
  const judgments: ConflictJudgment[] = [];

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const raw = await options.complete(buildAdjudicationPrompt(batch));
    const parsed = parseAdjudicationResponse(raw);

    for (const candidate of batch) {
      const verdict = parsed.get(candidate.id);
      judgments.push(
        verdict
          ? {
              candidateId: candidate.id,
              conflict: verdict.conflict,
              severity: verdict.severity,
              confidence: verdict.confidence,
              summary: verdict.summary || `Conflict between ${candidate.claims[0].documentId} and ${candidate.claims[1].documentId}`,
              rationale: verdict.rationale || "The adjudicator reported a contradiction without a rationale.",
            }
          : {
              candidateId: candidate.id,
              conflict: false,
              severity: "low",
              confidence: 0,
              summary: "",
              rationale: "The adjudicator returned no verdict for this pair, so it was not reported as a conflict.",
            },
      );
    }

    options.onProgress?.(Math.min(index + batchSize, candidates.length), candidates.length);
  }

  return judgments;
}
