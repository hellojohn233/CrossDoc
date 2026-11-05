import type { EvidenceSpan, ParsedDocument } from "../core/claims.js";
import {
  keyLabel,
  normalizeValue,
  type AlignedGroup,
  type AlignedPair,
  type KeyDataItem,
} from "../core/key-data.js";

const DEFAULT_MAX_PAIRS_PER_GROUP = 12;

/**
 * Stage 2 of a consistency review: line the documents up by key.
 *
 * Two documents that assert the same kind of data land in the same group even when
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
export function claimForItem(item: KeyDataItem, document: ParsedDocument | undefined) {
  const kind =
    item.key === "contract_value" || item.key === "currency" || item.key === "tax_rate" || item.key === "late_fee"
      ? "amount"
      : item.key === "effective_date" || item.key === "expiry_date" || item.key === "signing_date"
        ? "date"
        : "fact";

  return {
    id: item.id,
    documentId: item.documentId,
    kind: kind as "amount" | "date" | "fact",
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
