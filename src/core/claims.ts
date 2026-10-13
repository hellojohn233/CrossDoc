export interface EvidenceSpan {
  documentId: string;
  documentPath: string;
  page: number;
  quote: string;
}

export type ClaimKind = "obligation" | "date" | "amount" | "definition" | "fact" | "unknown";

export interface Claim {
  id: string;
  documentId: string;
  kind: ClaimKind;
  subject: string;
  predicate: string;
  value: string;
  normalizedValue: string;
  evidence: EvidenceSpan[];
  confidence: number;
}

export interface ParsedPage {
  page: number;
  text: string;
}

export interface ParsedDocument {
  id: string;
  path: string;
  title: string;
  pages: ParsedPage[];
  text: string;
}
