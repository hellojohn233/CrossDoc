import type { ReviewResult } from "./core/types.js";
import { compareClaims } from "./tools/compare.js";
import { extractClaims } from "./tools/extract.js";
import { parseDoc } from "./tools/parse.js";
import { reportConflicts } from "./tools/report.js";
import { verifyConflicts } from "./tools/verify.js";

export type ReviewStage = "parse" | "extract" | "compare" | "verify" | "report";

export interface ReviewProgress {
  stage: ReviewStage;
  message: string;
}

export interface ReviewOptions {
  onProgress?: (progress: ReviewProgress) => void;
}

export async function reviewDocuments(paths: string[], options: ReviewOptions = {}): Promise<ReviewResult> {
  const documents = [];

  for (const path of paths) {
    options.onProgress?.({ stage: "parse", message: `Parsing ${path}` });
    documents.push(await parseDoc(path));
  }

  options.onProgress?.({ stage: "extract", message: "Extracting claims" });
  const claims = documents.flatMap(extractClaims);

  options.onProgress?.({ stage: "compare", message: "Comparing claims" });
  const candidates = compareClaims(claims);

  options.onProgress?.({ stage: "verify", message: "Verifying candidate conflicts" });
  const conflicts = verifyConflicts(candidates);

  options.onProgress?.({ stage: "report", message: "Rendering Markdown report" });
  const reportMarkdown = reportConflicts({ documents, claims, conflicts });

  return {
    documents,
    claims,
    conflicts,
    reportMarkdown,
  };
}
