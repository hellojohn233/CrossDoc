import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ReviewResult } from "../core/types.js";

/** Persist the structured source data before the Markdown outputs are presented. */
export async function writeReviewArtifacts(result: ReviewResult, outputDirectory: string): Promise<void> {
  const root = resolve(outputDirectory);
  const documentsDirectory = resolve(root, "documents");
  await mkdir(documentsDirectory, { recursive: true });

  await Promise.all(
    result.documents.map((document) =>
      writeFile(resolve(documentsDirectory, `${document.id}.json`), `${JSON.stringify(document, null, 2)}\n`, "utf8"),
    ),
  );
  await writeFile(resolve(root, "review.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");

  await Promise.all([
    ...result.documents.map((document) =>
      writeFile(resolve(documentsDirectory, `${document.id}.md`), document.markdown, "utf8"),
    ),
    writeFile(resolve(root, "review.md"), result.reportMarkdown, "utf8"),
  ]);
}
