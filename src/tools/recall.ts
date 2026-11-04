import type { Claim } from "../core/claims.js";
import type { CandidatePair, RecallSignal } from "../core/types.js";

const LATIN_TOKEN_PATTERN = /[a-z0-9]+/g;
const CJK_RUN_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const CJK_NEGATIONS = [
  "不得",
  "不应",
  "不会",
  "无需",
  "不能",
  "禁止",
  "不予",
  "不构成",
  "不承担",
  "不负责",
  "无权",
  "无需再",
];
const LATIN_NEGATIONS = [
  "no",
  "not",
  "never",
  "without",
  "cannot",
  "must not",
  "shall not",
  "may not",
  "is not",
  "are not",
];
const DATE_PATTERN = /\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?|\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}/g;
const AMOUNT_PATTERN = /[$¥￥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|CNY|RMB|美元|人民币|元)/gi;
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

export interface RecallOptions {
  /** Minimum token overlap for a pair that carries no explicit difference signal. */
  minOverlap?: number;
  /** Minimum token overlap for a pair that only carries an explicit difference signal. */
  minSignalOverlap?: number;
  /** Upper bound on returned pairs, highest recall score first. */
  maxCandidates?: number;
}

interface PreparedClaim {
  claim: Claim;
  tokens: Set<string>;
  numbers: string[];
  dates: string[];
  amounts: string[];
  negation: boolean;
}

/**
 * Language-aware tokenization. Latin text becomes word tokens, CJK runs become
 * character bigrams, so a Chinese sentence is comparable instead of a single token.
 */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(LATIN_TOKEN_PATTERN)) tokens.push(match[0]);
  for (const match of normalized.matchAll(CJK_RUN_PATTERN)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index += 1) tokens.push(run.slice(index, index + 2));
  }
  return tokens;
}

/** Negation detection that works for CJK (no word boundaries there) and Latin. */
export function hasNegation(text: string): boolean {
  const lower = text.toLowerCase();
  if (CJK_NEGATIONS.some((term) => lower.includes(term))) return true;
  return LATIN_NEGATIONS.some((term) => new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "i").test(lower));
}

export function extractNumbers(text: string): string[] {
  return [...text.replace(DATE_PATTERN, " ").matchAll(NUMBER_PATTERN)].map((match) => match[0]);
}

export function extractDates(text: string): string[] {
  return [...text.matchAll(DATE_PATTERN)].map((match) => match[0].replace(/\s+/g, ""));
}

export function extractAmounts(text: string): string[] {
  return [...text.matchAll(AMOUNT_PATTERN)].map((match) => match[0].replace(/\s+/g, "").toLowerCase());
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function valueSetsDiffer(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  if (left.length !== right.length) return true;
  return left.some((value) => !rightSet.has(value));
}

/** Two statements with the same wording agree; they are not a conflict candidate. */
function sameWording(left: Claim, right: Claim): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[.。;；,，]+$/, "").trim();
  return normalize(left.value) === normalize(right.value);
}

function prepareClaim(claim: Claim): PreparedClaim {
  return {
    claim,
    tokens: new Set(tokenize(claim.normalizedValue || claim.value)),
    numbers: extractNumbers(claim.value),
    dates: extractDates(claim.value),
    amounts: extractAmounts(claim.value),
    negation: hasNegation(claim.value),
  };
}

/**
 * Stage 1 of the review: cheap recall of claim pairs that deserve a semantic look.
 *
 * This never decides whether two claims conflict. It only answers "which pairs
 * should the adjudicator read?". Recall is deliberately generous; precision is
 * the adjudicator's job.
 */
export function recallCandidates(claims: Claim[], options: RecallOptions = {}): CandidatePair[] {
  const minOverlap = options.minOverlap ?? 0.6;
  const minSignalOverlap = options.minSignalOverlap ?? 0.25;
  const maxCandidates = options.maxCandidates ?? 200;

  const prepared = claims.map(prepareClaim);
  const recalled: Omit<CandidatePair, "id">[] = [];

  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const left = prepared[leftIndex];
      const right = prepared[rightIndex];
      if (!left || !right) continue;
      if (left.claim.documentId === right.claim.documentId) continue;
      if (sameWording(left.claim, right.claim)) continue;

      const overlap = overlapScore(left.tokens, right.tokens);
      const signals: RecallSignal[] = [];
      if (left.negation !== right.negation) signals.push("opposite-polarity");
      if (valueSetsDiffer(left.dates, right.dates)) signals.push("different-date");
      if (valueSetsDiffer(left.amounts, right.amounts)) signals.push("different-amount");
      if (valueSetsDiffer(left.numbers, right.numbers)) signals.push("different-number");
      if (overlap >= 0.6) signals.push("shared-overlap");

      const hasDifference = signals.some((signal) => signal !== "shared-overlap");
      if (!hasDifference && overlap < minOverlap) continue;
      if (hasDifference && overlap < minSignalOverlap) continue;

      let recallScore = overlap;
      if (signals.includes("opposite-polarity")) recallScore += 0.5;
      if (signals.includes("different-date")) recallScore += 0.3;
      if (signals.includes("different-amount")) recallScore += 0.3;
      if (signals.includes("different-number")) recallScore += 0.25;

      recalled.push({
        claims: [left.claim, right.claim],
        recallScore: Math.min(1, recallScore),
        signals,
      });
    }
  }

  return recalled
    .sort((a, b) => b.recallScore - a.recallScore)
    .slice(0, maxCandidates)
    .map((pair, index) => ({ id: `conflict-${index + 1}`, ...pair }));
}
