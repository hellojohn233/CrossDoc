import type { DocumentBlock, ParsedDocument, SourceReference } from "../core/claims.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 8;
const MAX_EXCERPT_CHARACTERS = 420;

export interface SearchDocumentInput {
  query: string;
  documents: ParsedDocument[];
  maxResults?: number;
}

export interface DocumentExcerpt {
  documentId: string;
  title: string;
  excerpt: string;
  source: SourceReference;
}

export type SearchDocumentResult =
  | { status: "matches"; query: string; excerpts: DocumentExcerpt[] }
  | { status: "no-match"; query: string; excerpts: [] };

export class SearchDocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchDocumentInputError";
  }
}

interface QueryFeature {
  value: string;
  weight: number;
}

interface RankedExcerpt extends DocumentExcerpt {
  score: number;
  order: number;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function queryFeatures(query: string): QueryFeature[] {
  const features = new Map<string, number>();
  const normalized = normalize(query);
  const runs = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu) ?? [];

  for (const run of runs) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(run)) {
      const characters = [...run];
      if (characters.length === 1) features.set(run, Math.max(features.get(run) ?? 0, 1));
      for (const size of [2, 3]) {
        for (let index = 0; index + size <= characters.length; index += 1) {
          const value = characters.slice(index, index + size).join("");
          const weight = size === 3 ? 3 : 2;
          features.set(value, Math.max(features.get(value) ?? 0, weight));
        }
      }
    } else if ([...run].length >= 2) {
      features.set(run, 4);
    }
  }

  return [...features].map(([value, weight]) => ({ value, weight }));
}

function rankBlock(block: DocumentBlock, features: QueryFeature[]): number {
  const text = normalize(block.text);
  let score = 0;
  let matched = 0;

  for (const feature of features) {
    if (!text.includes(feature.value)) continue;
    score += feature.weight;
    matched += 1;
  }

  // One feature is enough for short queries; longer questions need two matches
  // so a common word alone does not pull in unrelated blocks.
  return matched >= Math.min(2, features.length) ? score : 0;
}

function excerpt(text: string, features: QueryFeature[]): string {
  const trimmed = text.trim();
  if ([...trimmed].length <= MAX_EXCERPT_CHARACTERS) return trimmed;

  const normalized = normalize(trimmed);
  let firstMatch = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const index = normalized.indexOf(feature.value);
    if (index >= 0) firstMatch = Math.min(firstMatch, index);
  }
  const center = Number.isFinite(firstMatch) ? firstMatch : 0;
  const start = Math.max(0, Math.min(center - Math.floor(MAX_EXCERPT_CHARACTERS / 3), [...trimmed].length - MAX_EXCERPT_CHARACTERS));
  return `${[...trimmed].slice(start, start + MAX_EXCERPT_CHARACTERS - 1).join("")}…`;
}

function validateInput(input: SearchDocumentInput): number {
  if (typeof input.query !== "string" || input.query.trim().length === 0) {
    throw new SearchDocumentInputError("query must contain at least one non-whitespace character");
  }
  if (!Array.isArray(input.documents)) {
    throw new SearchDocumentInputError("documents must be an array of parsed documents");
  }

  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
    throw new SearchDocumentInputError(`maxResults must be an integer from 1 to ${MAX_RESULTS}`);
  }
  return maxResults;
}

/** Search normalized document blocks and preserve the exact block source reference. */
export function searchDocument(input: SearchDocumentInput): SearchDocumentResult {
  const maxResults = validateInput(input);
  const query = input.query.trim();
  const features = queryFeatures(query);
  if (features.length === 0) {
    return { status: "no-match", query, excerpts: [] };
  }

  const ranked: RankedExcerpt[] = [];
  let order = 0;
  for (const document of input.documents) {
    for (const block of document.blocks) {
      const score = rankBlock(block, features);
      if (score > 0) {
        ranked.push({
          documentId: document.id,
          title: document.title,
          excerpt: excerpt(block.text, features),
          source: { blockId: block.id, location: block.source },
          score,
          order,
        });
      }
      order += 1;
    }
  }

  ranked.sort((left, right) => right.score - left.score || left.order - right.order);
  const excerpts = ranked.slice(0, maxResults).map(({ score: _score, order: _order, ...item }) => item);
  return excerpts.length > 0
    ? { status: "matches", query, excerpts }
    : { status: "no-match", query, excerpts: [] };
}

export const searchDocumentLimits = {
  defaultResults: DEFAULT_MAX_RESULTS,
  maxResults: MAX_RESULTS,
  maxExcerptCharacters: MAX_EXCERPT_CHARACTERS,
} as const;
