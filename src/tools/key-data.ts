import type { Claim, DocumentBlock, EvidenceSpan, ParsedDocument } from "../core/claims.js";
import {
  KEY_TAXONOMY,
  isTaxonomyKey,
  keyLabel,
  normalizeValue,
  type AlignedGroup,
  type AlignedPair,
  type KeyDataItem,
} from "../core/key-data.js";
import type { CompleteFn } from "./adjudicate.js";

const DEFAULT_MAX_CHARS_PER_REQUEST = 12_000;
const DEFAULT_MAX_PAIRS_PER_GROUP = 12;

export interface ExtractKeyDataOptions {
  complete: CompleteFn;
  maxCharsPerRequest?: number;
  onProgress?: (completed: number, total: number) => void;
}

/** The fixed vocabulary, rendered for the prompt. */
function taxonomyPrompt(): string {
  return KEY_TAXONOMY.map((entry) => `- ${entry.key}: ${entry.label}`).join("\n");
}

function pagesFor(document: ParsedDocument, maxChars: number): { page: number; text: string }[][] {
  const batches: { page: number; text: string }[][] = [];
  let current: { page: number; text: string }[] = [];
  let size = 0;
  for (const page of document.pages) {
    const text = page.text.trim();
    if (!text) continue;
    const entry = { page: page.page, text };
    if (current.length > 0 && size + text.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function buildKeyExtractionPrompt(document: ParsedDocument, pages: { page: number; text: string }[]): string {
  const body = pages.map((page) => `[page ${page.page}]\n${page.text}`).join("\n\n");
  return [
    "You are extracting the key data points that a document asserts about itself.",
    "List every material data point the document states, one item per key.",
    "",
    "Keys (use exactly one of these keys, choosing the closest one that fits):",
    taxonomyPrompt(),
    "",
    "Rules:",
    "- One item per key. If the document states several values for the same key, state the one the key names.",
    "- value: only the value itself. No surrounding words and no trailing clause.",
    "  Good: '90 days', 'USD 150000', 'March 1, 2026', 'Northwind Analytics and Bright Harbor Ltd.'",
    "  Bad: 'within 90 days of receipt', 'USD 150000 including delivery and support', 'Agreement between Northwind Analytics and Bright Harbor Ltd.'",
    "- quote: the exact sentence from the document that states the value. Copy it verbatim.",
    "- page: the page number that sentence is on.",
    "- Skip anything that is not a data point: headings, boilerplate, section titles, and sentences that state no value.",
    "- Never invent a value that is not in the text.",
    "",
    `Document: ${document.title}`,
    "",
    body,
    "",
    'Return ONLY a JSON array, no prose and no code fence:',
    '[{"key":"payment_term","value":"45 days","quote":"The exact sentence.","page":1}]',
  ].join("\n");
}

interface RawKeyItem {
  key?: unknown;
  value?: unknown;
  quote?: unknown;
  page?: unknown;
}

/** Tolerant JSON extraction for a key data array. */
export function parseKeyExtractionResponse(raw: string, documentId: string): KeyDataItem[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const items: KeyDataItem[] = [];
  for (const entry of parsed as RawKeyItem[]) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof entry.key === "string" ? entry.key.trim().toLowerCase().replace(/\s+/g, "_") : "";
    const value = typeof entry.value === "string" ? entry.value.trim() : "";
    const quote = typeof entry.quote === "string" ? entry.quote.trim() : "";
    if (!key || !value || !quote) continue;
    const page = typeof entry.page === "number" && Number.isFinite(entry.page) ? entry.page : undefined;
    const custom = !isTaxonomyKey(key);
    items.push({
      id: `${documentId}:${key}:${items.length + 1}`,
      documentId,
      key,
      label: keyLabel(key),
      value,
      quote,
      ...(page === undefined ? {} : { page }),
      confidence: 0.8,
      custom,
    });
  }
  return items;
}

/**
 * Stage 1 of the review: ask a language model which key data points a document asserts.
 * One request per document, not per pair of documents.
 */
export async function extractKeyData(document: ParsedDocument, options: ExtractKeyDataOptions): Promise<KeyDataItem[]> {
  const maxChars = options.maxCharsPerRequest ?? DEFAULT_MAX_CHARS_PER_REQUEST;
  const batches = pagesFor(document, maxChars);
  if (batches.length === 0) return [];

  const items: KeyDataItem[] = [];
  for (const [index, batch] of batches.entries()) {
    const raw = await options.complete(buildKeyExtractionPrompt(document, batch));
    for (const item of parseKeyExtractionResponse(raw, document.id)) {
      items.push({ ...item, id: `${document.id}:${item.key}:${items.length + 1}` });
    }
    options.onProgress?.(index + 1, batches.length);
  }
  return items;
}

/**
 * Stage 2 of the review: line the documents up by key.
 *
 * Two documents asserting the same kind of data land in the same group even when
 * they share no wording, because the key comes from the fixed vocabulary.
 *
 * A document states one value per key. When it states several, the most specific
 * one is kept, so a group never crosses the same two documents more than once.
 */
export function alignKeyData(items: KeyDataItem[]): AlignedGroup[] {
  const bestPerDocument = new Map<string, KeyDataItem>();
  for (const item of items) {
    const slot = `${item.key}::${item.documentId}`;
    const current = bestPerDocument.get(slot);
    if (!current) {
      bestPerDocument.set(slot, item);
      continue;
    }
    if (item.value.length > current.value.length) bestPerDocument.set(slot, item);
  }

  const groups = new Map<string, KeyDataItem[]>();
  for (const item of bestPerDocument.values()) {
    const list = groups.get(item.key) ?? [];
    list.push(item);
    groups.set(item.key, list);
  }

  return [...groups.entries()]
    .map(([key, groupItems]) => {
      const values = [...new Set(groupItems.map((item) => normalizeValue(item.value)))];
      return {
        key,
        label: groupItems[0]?.label ?? keyLabel(key),
        items: groupItems,
        values,
        consistent: values.length <= 1,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function crossDocumentPair(lefts: KeyDataItem[], rights: KeyDataItem[]): [KeyDataItem, KeyDataItem] | undefined {
  for (const left of lefts) {
    for (const right of rights) {
      if (left.documentId !== right.documentId) return [left, right];
    }
  }
  return undefined;
}

/**
 * Turn aligned groups into the pairs that actually disagree.
 * Groups where every document says the same thing produce nothing.
 */
export function expandAlignedPairs(groups: AlignedGroup[], maxPairsPerGroup = DEFAULT_MAX_PAIRS_PER_GROUP): AlignedPair[] {
  const pairs: AlignedPair[] = [];

  for (const group of groups) {
    if (group.consistent) continue;

    const byValue = new Map<string, KeyDataItem[]>();
    for (const item of group.items) {
      const normalized = normalizeValue(item.value);
      const list = byValue.get(normalized) ?? [];
      list.push(item);
      byValue.set(normalized, list);
    }

    const valueKeys = [...byValue.keys()];
    let produced = 0;
    for (let i = 0; i < valueKeys.length && produced < maxPairsPerGroup; i += 1) {
      const leftKey = valueKeys[i];
      if (leftKey === undefined) continue;
      for (let j = i + 1; j < valueKeys.length && produced < maxPairsPerGroup; j += 1) {
        const rightKey = valueKeys[j];
        if (rightKey === undefined) continue;
        const lefts = byValue.get(leftKey) ?? [];
        const rights = byValue.get(rightKey) ?? [];
        const match = crossDocumentPair(lefts, rights);
        if (!match) continue;
        pairs.push({
          id: `pair-${pairs.length + 1}`,
          key: group.key,
          label: group.label,
          left: match[0],
          right: match[1],
          group: group.items,
        });
        produced += 1;
      }
    }
  }

  return pairs;
}

/** Finds the source blocks a quoted sentence came from, so a finding stays traceable. */
export function sourceBlocksFor(document: ParsedDocument, item: KeyDataItem): EvidenceSpan["sourceBlocks"] {
  const quote = item.quote.trim();
  if (!quote) return [];
  const blocks = document.blocks.filter((block) => {
    if (item.page !== undefined && block.source.type === "pdf" && block.source.page !== item.page) return false;
    const text = block.text.trim();
    if (!text) return false;
    return quote.includes(text) || text.includes(quote);
  });
  return blocks.slice(0, 8).map((block) => ({ blockId: block.id, location: block.source }));
}

/** Builds the claim the ledger renders for one side of a comparison. */
export function claimForItem(item: KeyDataItem, document: ParsedDocument | undefined): Claim {
  const kind =
    item.key === "contract_value" || item.key === "currency" || item.key === "tax_rate" || item.key === "late_fee"
      ? "amount"
      : item.key === "effective_date" || item.key === "expiry_date" || item.key === "signing_date"
        ? "date"
        : "fact";

  return {
    id: item.id,
    documentId: item.documentId,
    kind,
    subject: item.label,
    predicate: item.key,
    value: item.value,
    normalizedValue: normalizeValue(item.value),
    evidence: [
      {
        id: `${item.id}:e1`,
        documentId: item.documentId,
        ...(item.page === undefined ? {} : { page: item.page }),
        quote: item.quote,
        sourceBlocks: document ? sourceBlocksFor(document, item) : [],
      },
    ],
    confidence: item.confidence,
  };
}

/** Blocks of a document that carry text, used by the rule-based fallback. */
export function documentSentences(document: ParsedDocument): { page: number; text: string }[] {
  const sentences: { page: number; text: string }[] = [];
  for (const page of document.pages) {
    for (const line of page.text.split(/\n+/)) {
      const text = line.trim();
      if (text.length >= 8) sentences.push({ page: page.page, text });
    }
  }
  return sentences;
}

export type { DocumentBlock };
