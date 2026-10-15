import { loadDocument } from "../loaders/index.js";
import type { ParseDocumentOptions } from "../loaders/types.js";

/** Tool-facing parser entry point; format-specific parsing lives in `loaders/`. */
export function parseDoc(path: string, options?: ParseDocumentOptions) {
  return loadDocument(path, options);
}
