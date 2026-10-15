import { extname } from "node:path";

import type { ParsedDocument } from "../core/claims.js";
import { pdfLoader } from "./pdf.js";
import type { DocumentLoader, ParseDocumentOptions } from "./types.js";

const loaders: DocumentLoader[] = [pdfLoader];

export async function loadDocument(path: string, options?: ParseDocumentOptions): Promise<ParsedDocument> {
  const extension = extname(path).toLowerCase();
  const loader = loaders.find((candidate) => candidate.extensions.includes(extension));
  if (!loader) {
    throw new Error(`Unsupported document format: ${extension || "unknown"}.`);
  }

  return loader.parse(path, options);
}
