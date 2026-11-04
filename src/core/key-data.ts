/** One entry of the fixed key vocabulary a reviewer may use. */
export interface KeyTaxonomyEntry {
  key: string;
  label: string;
}

/**
 * The fixed key vocabulary. The extraction prompt offers exactly these keys, so
 * two documents that assert the same kind of data line up on the same key
 * instead of relying on shared wording.
 */
export const KEY_TAXONOMY: readonly KeyTaxonomyEntry[] = [
  { key: "contract_subject", label: "签约主体 / 对手方" },
  { key: "contract_value", label: "合同金额" },
  { key: "currency", label: "币种" },
  { key: "payment_term", label: "付款期限" },
  { key: "payment_method", label: "支付方式" },
  { key: "late_fee", label: "逾期利息 / 违约金" },
  { key: "effective_date", label: "生效日期" },
  { key: "expiry_date", label: "到期日期" },
  { key: "term_length", label: "服务期限" },
  { key: "renewal", label: "续约条件" },
  { key: "termination_notice", label: "终止通知期" },
  { key: "liability_cap", label: "责任上限" },
  { key: "insurance", label: "保险要求" },
  { key: "service_scope", label: "服务范围" },
  { key: "service_level", label: "服务水平 / SLA" },
  { key: "acceptance", label: "验收标准" },
  { key: "confidentiality", label: "保密义务与期限" },
  { key: "data_protection", label: "数据保护" },
  { key: "non_compete", label: "竞业限制" },
  { key: "ip_ownership", label: "知识产权归属" },
  { key: "governing_law", label: "适用法律" },
  { key: "jurisdiction", label: "争议解决地" },
  { key: "notice_address", label: "通知地址" },
  { key: "tax_rate", label: "税率" },
  { key: "signing_date", label: "签署日期" },
];

const TAXONOMY_BY_KEY = new Map(KEY_TAXONOMY.map((entry) => [entry.key, entry]));

export function isTaxonomyKey(key: string): boolean {
  return TAXONOMY_BY_KEY.has(key);
}

export function keyLabel(key: string): string {
  return TAXONOMY_BY_KEY.get(key)?.label ?? key;
}

/** A key data point one document asserts about itself. */
export interface KeyDataItem {
  id: string;
  documentId: string;
  /** Taxonomy key, or a custom slug when no taxonomy entry fits. */
  key: string;
  label: string;
  /** The value as the document states it. */
  value: string;
  /** The exact source sentence the value was taken from. */
  quote: string;
  page?: number;
  confidence: number;
  /** True when the key is not part of the fixed vocabulary. */
  custom: boolean;
}

/** Every document's value for one key, lined up. */
export interface AlignedGroup {
  key: string;
  label: string;
  items: KeyDataItem[];
  /** Distinct normalized values in this group. */
  values: string[];
  /** True when every document states the same value. */
  consistent: boolean;
}

/** Two documents stating different values for the same key. */
export interface AlignedPair {
  id: string;
  key: string;
  label: string;
  left: KeyDataItem;
  right: KeyDataItem;
  /** Every document's value for this key, so the verdict sees the whole picture. */
  group: KeyDataItem[];
}

/**
 * Normalizes a value for comparison. Two spellings of the same value normalize
 * to the same string; a genuine difference does not.
 */
export function normalizeValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/(\d)\.0+\b/g, "$1")
    .replace(/[，。、；：,.;:()（）\[\]【】"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an)\s+/, "");
}
