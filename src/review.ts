import type { Adjudicator, JudgeSource, ReviewResult } from "./core/types.js";
import type { ParseDocumentOptions } from "./loaders/types.js";
import { extractClaims } from "./tools/extract.js";
import { parseDoc } from "./tools/parse.js";
import { recallCandidates } from "./tools/recall.js";
import { reportConflicts } from "./tools/report.js";
import { ruleAdjudicate } from "./tools/rule-adjudicate.js";
import { verifyConflicts } from "./tools/verify.js";

export type ReviewStage = "parse" | "extract" | "recall" | "adjudicate" | "verify" | "report";

export interface ReviewProgress {
  stage: ReviewStage;
  message: string;
}

export interface ReviewOptions {
  onProgress?: (progress: ReviewProgress) => void;
  documents?: ParseDocumentOptions[];
  /**
   * Semantic adjudicator for the recalled candidates. When it is missing the review
   * falls back to rule adjudication, which only catches explicit contradictions.
   */
  adjudicator?: Adjudicator;
}

export async function reviewDocuments(paths: string[], options: ReviewOptions = {}): Promise<ReviewResult> {
  const documents = [];

  for (const [index, path] of paths.entries()) {
    options.onProgress?.({ stage: "parse", message: `Parsing ${path}` });
    documents.push(await parseDoc(path, options.documents?.[index]));
  }

  options.onProgress?.({ stage: "extract", message: "Extracting claims" });
  const claims = documents.flatMap(extractClaims);

  options.onProgress?.({ stage: "recall", message: "Recalling candidate claim pairs" });
  const candidates = recallCandidates(claims);

  options.onProgress?.({ stage: "adjudicate", message: `Adjudicating ${candidates.length} candidate pairs` });
  const adjudication = options.adjudicator
    ? await options.adjudicator(candidates)
    : {
        judgments: ruleAdjudicate(candidates),
        source: "rule" as JudgeSource,
        warning: "No adjudicator was supplied, so the conflicts were judged by rules only.",
      };

  options.onProgress?.({ stage: "verify", message: "Verifying conflict evidence" });
  const conflicts = verifyConflicts(candidates, adjudication.judgments, { judgeSource: adjudication.source });

  options.onProgress?.({ stage: "report", message: "Rendering Markdown report" });
  const reportMarkdown = reportConflicts({ documents, claims, conflicts });

  return {
    documents,
    claims,
    conflicts,
    reportMarkdown,
    judgeSource: adjudication.source,
    ...(adjudication.warning ? { warning: adjudication.warning } : {}),
  };
}
