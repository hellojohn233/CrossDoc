#!/usr/bin/env node

import { glob, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { reviewDocuments } from "./review.js";
import { createBuiltinModels } from "./agent.js";
import { createModelAdjudicator } from "./model-adjudicator.js";
import { LocalDatabase } from "./storage/database.js";
import { writeReviewArtifacts } from "./storage/review-store.js";

function usage(): never {
  console.error("Usage: crossdoc review <glob-or-pdf> [more-globs-or-pdfs]");
  process.exit(1);
}

async function resolveInputs(patterns: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for await (const match of glob(pattern)) {
      files.add(resolve(match));
    }
  }

  return [...files].filter((file) => file.toLowerCase().endsWith(".pdf"));
}

async function review(patterns: string[]): Promise<void> {
  if (patterns.length === 0) usage();

  const files = await resolveInputs(patterns);
  if (files.length === 0) {
    throw new Error(`No PDF files matched: ${patterns.join(", ")}`);
  }

  console.log(`CrossDoc reviewing ${files.length} document(s)...`);

  const database = new LocalDatabase(resolve("data"));
  const result = await reviewDocuments(files, {
    onProgress: (progress) => console.log(`- ${progress.message}`),
    adjudicator: createModelAdjudicator(createBuiltinModels(), database.getModelProfile("main")),
  });

  const outDir = resolve("crossdoc-output");
  await mkdir(outDir, { recursive: true });
  await writeReviewArtifacts(result, outDir);

  console.log(`Claims: ${result.claims.length}`);
  console.log(`Conflicts: ${result.conflicts.filter((conflict) => conflict.status === "verified").length} verified / ${result.conflicts.length} total`);
  console.log(`Judge: ${result.judgeSource ?? "rule"}`);
  if (result.warning) console.log(`Warning: ${result.warning}`);
  console.log(`Structured review: ${resolve(outDir, "review.json")}`);
  console.log(`Report: ${resolve(outDir, "review.md")}`);
  console.log(`Parsed documents: ${resolve(outDir, "documents")}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command !== "review") usage();
  await review(args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
