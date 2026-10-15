import type { ParsedDocument } from "../core/claims.js";

export interface ParseDocumentOptions {
  id?: string;
  title?: string;
}

export interface DocumentLoader {
  format: ParsedDocument["format"];
  extensions: string[];
  parse(path: string, options?: ParseDocumentOptions): Promise<ParsedDocument>;
}
