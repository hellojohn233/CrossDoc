import type { DocumentBlock, ParsedDocument, SourceReference } from "../core/claims.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 8;
const MAX_QUERY_CHARACTERS = 500;
const MAX_DOCUMENTS = 32;
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

function normalizeWithOffsets(value: string): { value: string; originalCodePointOffsets: number[] } {
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  let normalized = "";
  const originalCodePointOffsets: number[] = [];
  let originalCodePointOffset = 0;

  for (const { segment } of segmenter.segment(value)) {
    const normalizedSegment = normalize(segment);
    normalized += normalizedSegment;
    // indexOf returns UTF-16 offsets; each normalized UTF-16 unit maps back to
    // the codepoint position of its original grapheme cluster.
    for (let index = 0; index < normalizedSegment.length; index += 1) {
      originalCodePointOffsets.push(originalCodePointOffset);
    }
    originalCodePointOffset += [...segment].length;
  }
  return { value: normalized, originalCodePointOffsets };
}

function excerpt(text: string, features: QueryFeature[]): string {
  const trimmed = text.trim();
  const characters = [...trimmed];
  if (characters.length <= MAX_EXCERPT_CHARACTERS) return trimmed;

  const normalized = normalizeWithOffsets(trimmed);
  let firstMatch = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const index = normalized.value.indexOf(feature.value);
    if (index >= 0) {
      firstMatch = Math.min(firstMatch, normalized.originalCodePointOffsets[index] ?? 0);
    }
  }
  const matchStart = Number.isFinite(firstMatch) ? firstMatch : 0;
  const maxStart = Math.max(0, characters.length - MAX_EXCERPT_CHARACTERS);
  const start = Math.min(maxStart, Math.max(0, matchStart - Math.floor(MAX_EXCERPT_CHARACTERS / 3)));
  return `${characters.slice(start, start + MAX_EXCERPT_CHARACTERS - 1).join("")}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isSourceLocation(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "pdf") {
    return Number.isInteger(value.page) && Number(value.page) > 0 && isFiniteNumberArray(value.bbox, 4) && isFiniteNumberArray(value.pageBounds, 4);
  }
  if (value.type === "docx") {
    return ["paragraphIndex", "tableIndex", "rowIndex", "columnIndex", "textStart", "textEnd"].every((key) =>
      value[key] === undefined || (Number.isInteger(value[key]) && Number(value[key]) >= 0),
    );
  }
  if (value.type === "xlsx") {
    return typeof value.sheet === "string" && value.sheet.length > 0 && typeof value.range === "string" && value.range.length > 0;
  }
  if (value.type === "image") {
    return (
      (value.page === undefined || (Number.isInteger(value.page) && Number(value.page) > 0)) &&
      isFiniteNumberArray(value.bbox, 4) &&
      isFiniteNumberArray(value.imageBounds, 2)
    );
  }
  return false;
}

function validateBlock(value: unknown, label: string, expectedSourceType: string): asserts value is DocumentBlock {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" || value.id.trim().length === 0 ||
    value.kind !== "text" || typeof value.text !== "string" ||
    !Number.isInteger(value.start) || Number(value.start) < 0 ||
    !Number.isInteger(value.end) || Number(value.end) < Number(value.start) ||
    !isSourceLocation(value.source) ||
    !isRecord(value.source) || value.source.type !== expectedSourceType
  ) {
    throw new SearchDocumentInputError(`${label} is invalid`);
  }
}

function validateDocument(value: unknown, index: number): asserts value is ParsedDocument {
  if (!isRecord(value)) throw new SearchDocumentInputError(`documents[${index}] must be an object`);
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new SearchDocumentInputError(`documents[${index}].id must be a non-empty string`);
  }
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    throw new SearchDocumentInputError(`documents[${index}].title must be a non-empty string`);
  }
  if (!["pdf", "docx", "xlsx", "image"].includes(String(value.format))) {
    throw new SearchDocumentInputError(`documents[${index}].format is unsupported`);
  }
  const expectedSourceType = String(value.format);
  if (!Array.isArray(value.pages) || !Array.isArray(value.blocks)) {
    throw new SearchDocumentInputError(`documents[${index}] must contain pages and blocks arrays`);
  }
  if (typeof value.text !== "string" || typeof value.markdown !== "string") {
    throw new SearchDocumentInputError(`documents[${index}] must contain text and markdown strings`);
  }
  if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string")) {
    throw new SearchDocumentInputError(`documents[${index}].warnings must be an array of strings`);
  }

  for (const [blockIndex, block] of value.blocks.entries()) {
    validateBlock(block, `documents[${index}].blocks[${blockIndex}]`, expectedSourceType);
  }
  for (const [pageIndex, page] of value.pages.entries()) {
    if (
      !isRecord(page) || !Number.isInteger(page.page) || Number(page.page) < 1 ||
      typeof page.text !== "string" || !Array.isArray(page.blocks) ||
      (page.classification !== undefined && !["text-native", "scan-candidate", "blank-unknown"].includes(String(page.classification))) ||
      (page.extractionMethod !== undefined && !["native-text", "pending-vision", "none"].includes(String(page.extractionMethod)))
    ) {
      throw new SearchDocumentInputError(`documents[${index}].pages[${pageIndex}] is invalid`);
    }
    for (const [blockIndex, block] of page.blocks.entries()) {
      validateBlock(block, `documents[${index}].pages[${pageIndex}].blocks[${blockIndex}]`, expectedSourceType);
    }
  }
}

function validateInput(input: unknown): { query: string; documents: ParsedDocument[]; maxResults: number } {
  if (!isRecord(input)) throw new SearchDocumentInputError("input must be an object");
  if (typeof input.query !== "string" || input.query.trim().length === 0) {
    throw new SearchDocumentInputError("query must contain at least one non-whitespace character");
  }
  const query = input.query.trim();
  if ([...query].length > MAX_QUERY_CHARACTERS) {
    throw new SearchDocumentInputError(`query must not exceed ${MAX_QUERY_CHARACTERS} characters`);
  }
  if (!Array.isArray(input.documents)) {
    throw new SearchDocumentInputError("documents must be an array of parsed documents");
  }
  if (input.documents.length > MAX_DOCUMENTS) {
    throw new SearchDocumentInputError(`documents must not contain more than ${MAX_DOCUMENTS} items`);
  }
  input.documents.forEach(validateDocument);

  const requestedMaxResults = input.maxResults;
  const maxResults = requestedMaxResults === undefined ? DEFAULT_MAX_RESULTS : requestedMaxResults;
  if (typeof maxResults !== "number" || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
    throw new SearchDocumentInputError(`maxResults must be an integer from 1 to ${MAX_RESULTS}`);
  }
  return { query, documents: input.documents as ParsedDocument[], maxResults };
}

/** Search normalized document blocks and preserve the exact block source reference. */
export function searchDocument(input: SearchDocumentInput): SearchDocumentResult {
  const { query, documents, maxResults } = validateInput(input);
  const features = queryFeatures(query);
  if (features.length === 0) {
    return { status: "no-match", query, excerpts: [] };
  }

  const ranked: RankedExcerpt[] = [];
  let order = 0;
  for (const document of documents) {
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
  maxQueryCharacters: MAX_QUERY_CHARACTERS,
  maxDocuments: MAX_DOCUMENTS,
  maxExcerptCharacters: MAX_EXCERPT_CHARACTERS,
} as const;
