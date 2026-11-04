import type { Adjudicator, JudgeSource, ReviewModel, ReviewResult } from "./core/types.js";
import type { ParseDocumentOptions } from "./loaders/types.js";
import { alignKeyData, claimForItem, expandAlignedPairs } from "./tools/key-data.js";
import { parseDoc } from "./tools/parse.js";
import { reportConflicts } from "./tools/report.js";
import { extractKeyDataByRules } from "./tools/rule-key-data.js";
import { ruleAdjudicatePairs } from "./tools/rule-adjudicate.js";
import { verifyConflicts } from "./tools/verify.js";

export type ReviewStage = "parse" | "extract" | "align" | "adjudicate" | "verify" | "report";

export interface ReviewProgress {
  stage: ReviewStage;
  message: string;
}

export interface ReviewOptions {
  onProgress?: (progress: ReviewProgress) => void;
  documents?: ParseDocumentOptions[];
  /**
   * The model-backed stages. When it is missing the review falls back to rule
   * extraction and rule verdicts, which only catch explicit value differences.
   */
  model?: ReviewModel;
}

export async function reviewDocuments(paths: string[], options: ReviewOptions = {}): Promise<ReviewResult> {
  const documents = [];

  for (const [index, path] of paths.entries()) {
    options.onProgress?.({ stage: "parse", message: `Parsing ${path}` });
    documents.push(await parseDoc(path, options.documents?.[index]));
  }

  options.onProgress?.({ stage: "extract", message: "Extracting key data" });
  const extractions = await Promise.all(
    documents.map((document) =>
      options.model
        ? options.model.extractKeyData(document)
        : Promise.resolve({ items: extractKeyDataByRules(document), source: "rule" as JudgeSource, warning: "No model was supplied, so the key data was extracted by rules only." }),
    ),
  );
  const keyData = extractions.flatMap((extraction) => extraction.items);
  const warnings = [...new Set(extractions.map((extraction) => extraction.warning).filter((warning): warning is string => Boolean(warning)))];

  options.onProgress?.({ stage: "align", message: `Aligning ${keyData.length} key data points` });
  const groups = alignKeyData(keyData);
  const pairs = expandAlignedPairs(groups);

  options.onProgress?.({ stage: "adjudicate", message: `Adjudicating ${pairs.length} differing values` });
  const adjudication = options.model
    ? await options.model.adjudicate(pairs)
    : {
        judgments: ruleAdjudicatePairs(pairs),
        source: "rule" as JudgeSource,
        warning: "No model was supplied, so the conflicts were judged by rules only.",
      };
  if (adjudication.warning) warnings.push(adjudication.warning);

  options.onProgress?.({ stage: "verify", message: "Verifying conflict evidence" });
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const conflicts = verifyConflicts(pairs, adjudication.judgments, {
    judgeSource: adjudication.source,
    documents: documentById,
  });

  const claims = keyData.map((item) => claimForItem(item, documentById.get(item.documentId)));

  options.onProgress?.({ stage: "report", message: "Rendering Markdown report" });
  const reportMarkdown = reportConflicts({ documents, claims, conflicts });

  return {
    documents,
    claims,
    conflicts,
    reportMarkdown,
    judgeSource: adjudication.source,
    ...(warnings.length > 0 ? { warning: [...new Set(warnings)].join(" ") } : {}),
  };
}
