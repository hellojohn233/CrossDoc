import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

/** One stored review, reduced to what a list needs to show it. */
export interface ReviewSummary {
  id: string;
  createdAt: string;
  titles: string[];
  documentCount: number;
  claimCount: number;
  conflictCount: number;
  verifiedConflictCount: number;
}

/**
 * Lists the stored reviews, newest first.
 *
 * The reviews are read from disk rather than kept in an index, so a review
 * that was copied into the folder is still listed. The folders are ordered by
 * modification time before anything is read, so only the newest ones are
 * parsed.
 */
export async function listReviewArtifacts(outputDirectory: string, limit = 50): Promise<ReviewSummary[]> {
  const root = resolve(outputDirectory);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const folders: { id: string; modifiedAt: number }[] = [];
  for (const id of entries) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
    try {
      const stats = await stat(resolve(root, id));
      if (!stats.isDirectory()) continue;
      folders.push({ id, modifiedAt: stats.mtimeMs });
    } catch {
      continue;
    }
  }
  folders.sort((left, right) => right.modifiedAt - left.modifiedAt);

  const summaries: ReviewSummary[] = [];
  for (const folder of folders.slice(0, limit)) {
    const result = await readReviewArtifact(outputDirectory, folder.id);
    if (!result) continue;
    summaries.push({
      id: folder.id,
      createdAt: new Date(folder.modifiedAt).toISOString(),
      titles: result.documents.map((document) => document.title),
      documentCount: result.documents.length,
      claimCount: result.claims.length,
      conflictCount: result.conflicts.length,
      verifiedConflictCount: result.conflicts.filter((conflict) => conflict.status === "verified").length,
    });
  }

  return summaries;
}

/** Reads one stored review. The id is a directory name, so it is confined to the folder. */
export async function readReviewArtifact(outputDirectory: string, id: string): Promise<ReviewResult | undefined> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return undefined;
  try {
    const raw = await readFile(resolve(resolve(outputDirectory), id, "review.json"), "utf8");
    const parsed = JSON.parse(raw) as ReviewResult;
    if (!parsed || !Array.isArray(parsed.conflicts) || !Array.isArray(parsed.documents)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
