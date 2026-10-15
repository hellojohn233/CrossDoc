export interface EvidenceSpan {
  id: string;
  documentId: string;
  page?: number;
  quote: string;
  sourceBlocks: SourceReference[];
}

export interface PdfSourceLocation {
  type: "pdf";
  page: number;
  /** Rectangle in PDF user space: [left, bottom, right, top]. */
  bbox: [number, number, number, number];
  /** Visible page rectangle in the same coordinate system. */
  pageBounds: [number, number, number, number];
}

export interface DocxSourceLocation {
  type: "docx";
  paragraphIndex?: number;
  tableIndex?: number;
  rowIndex?: number;
  columnIndex?: number;
  textStart?: number;
  textEnd?: number;
}

export interface XlsxSourceLocation {
  type: "xlsx";
  sheet: string;
  range: string;
}

export interface ImageSourceLocation {
  type: "image";
  page?: number;
  bbox: [number, number, number, number];
  imageBounds: [number, number];
}

export type SourceLocation = PdfSourceLocation | DocxSourceLocation | XlsxSourceLocation | ImageSourceLocation;

export interface SourceReference {
  blockId: string;
  location: SourceLocation;
}

export interface DocumentBlock {
  id: string;
  kind: "text";
  text: string;
  source: SourceLocation;
  /** Character offsets of this text inside its page's normalized text. */
  start: number;
  end: number;
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
  blocks: DocumentBlock[];
  /** PDF-only page classification. Other loaders may omit it. */
  classification?: "text-native" | "scan-candidate" | "blank-unknown";
  /** How page text was obtained, or which reader should process it next. */
  extractionMethod?: "native-text" | "pending-vision" | "none";
}

export interface ParsedDocument {
  id: string;
  title: string;
  format: "pdf" | "docx" | "xlsx" | "image";
  pages: ParsedPage[];
  blocks: DocumentBlock[];
  text: string;
  markdown: string;
  warnings: string[];
}
