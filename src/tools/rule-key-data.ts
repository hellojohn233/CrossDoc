import type { ParsedDocument } from "../core/claims.js";
import { keyLabel, type KeyDataItem } from "../core/key-data.js";
import { documentSentences } from "./key-data.js";

interface Rule {
  key: string;
  pattern: RegExp;
  /** Returns the value, or undefined when the sentence does not state one. */
  read: (match: RegExpMatchArray) => string | undefined;
}

const RULES: Rule[] = [
  {
    key: "contract_subject",
    pattern: /\bbetween\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)\s+and\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/,
    read: (match) => (match[1] && match[2] ? `${match[1]} and ${match[2]}` : undefined),
  },
  {
    key: "payment_term",
    pattern: /(?:pay|paid|payment|invoice)[^.]*?\bwithin\s+(\d+\s*(?:days?|天|日))/i,
    read: (match) => match[1] ?? undefined,
  },
  {
    key: "contract_value",
    pattern:
      /\b(?:total\s+)?(?:contract\s+)?(?:value|price|fee)[^.]*?\b(?:is|of)\s+((?:USD|CNY|RMB|EUR|GBP|美元|人民币|元|[$¥￥])\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:USD|CNY|RMB|美元|人民币|元)?)/i,
    read: (match) => match[1] ?? undefined,
  },
  {
    key: "effective_date",
    pattern: /\btakes effect on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)/i,
    read: (match) => match[1] ?? undefined,
  },
  {
    key: "expiry_date",
    pattern: /\b(?:expires?|until)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)/i,
    read: (match) => match[1] ?? undefined,
  },
  {
    key: "term_length",
    pattern: /\bfor\s+(\w+\s+months?|\d+\s*(?:years?|个月|年))\b/i,
    read: (match) => match[1] ?? undefined,
  },
  {
    key: "governing_law",
    pattern: /\blaws of\s+the\s+([A-Z][\w\s]*?)(?:\.|$)/,
    read: (match) => match[1]?.trim() ?? undefined,
  },
  {
    key: "currency",
    pattern: /\b(USD|CNY|RMB|EUR|GBP)\b/,
    read: (match) => match[1] ?? undefined,
  },
];

/**
 * Degraded key extraction used when no language model is configured or the model call failed.
 *
 * It only recognises the data points a pattern can name. It never understands
 * wording, so it stays conservative and is always reported as a rule pass.
 */
export function extractKeyDataByRules(document: ParsedDocument): KeyDataItem[] {
  const items: KeyDataItem[] = [];

  for (const sentence of documentSentences(document)) {
    for (const rule of RULES) {
      const match = sentence.text.match(rule.pattern);
      if (!match) continue;
      const value = rule.read(match);
      if (!value) continue;
      items.push({
        id: `${document.id}:${rule.key}:${items.length + 1}`,
        documentId: document.id,
        key: rule.key,
        label: keyLabel(rule.key),
        value: value.trim(),
        quote: sentence.text,
        page: sentence.page,
        confidence: 0.5,
        custom: false,
      });
      break;
    }
  }

  return items;
}
