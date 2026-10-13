#!/usr/bin/env node

import { glob, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { reviewDocuments } from "./review.js";

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

  const result = await reviewDocuments(files, {
    onProgress: (progress) => console.log(`- ${progress.message}`),
  });

  const outDir = resolve("crossdoc-output");
  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(outDir, "review.md");
  await writeFile(reportPath, result.reportMarkdown, "utf8");

  console.log(`Claims: ${result.claims.length}`);
  console.log(`Conflicts: ${result.conflicts.filter((conflict) => conflict.status === "verified").length} verified / ${result.conflicts.length} total`);
  console.log(`Report: ${reportPath}`);
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
