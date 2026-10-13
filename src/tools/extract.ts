import type { Claim, ClaimKind, ParsedDocument, ParsedPage } from "../core/claims.js";

const DATE_PATTERN = /\b(?:20\d{2}|19\d{2})[-/.年](?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\d|3[01])日?\b/g;
const MONEY_PATTERN = /(?:[$¥￥]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|CNY|RMB|美元|人民币|元)\b)/gi;
const OBLIGATION_PATTERN = /(shall|must|required to|不得|必须|应当|需要|负责)/i;

function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function inferKind(sentence: string): ClaimKind {
  if (DATE_PATTERN.test(sentence)) return "date";
  DATE_PATTERN.lastIndex = 0;
  if (MONEY_PATTERN.test(sentence)) return "amount";
  MONEY_PATTERN.lastIndex = 0;
  if (OBLIGATION_PATTERN.test(sentence)) return "obligation";
  return "fact";
}

function sentenceCandidates(page: ParsedPage): string[] {
  return page.text
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
}

function claimFromSentence(document: ParsedDocument, page: ParsedPage, sentence: string, index: number): Claim {
  const kind = inferKind(sentence);
  const value = sentence.slice(0, 500);

  return {
    id: `${document.id}:p${page.page}:c${index + 1}`,
    documentId: document.id,
    kind,
    subject: document.title,
    predicate: kind,
    value,
    normalizedValue: normalizeValue(value),
    evidence: [
      {
        documentId: document.id,
        documentPath: document.path,
        page: page.page,
        quote: value,
      },
    ],
    confidence: 0.45,
  };
}

export function extractClaims(document: ParsedDocument): Claim[] {
  return document.pages.flatMap((page) =>
    sentenceCandidates(page).map((sentence, index) => claimFromSentence(document, page, sentence, index)),
  );
}
