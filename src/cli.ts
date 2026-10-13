#!/usr/bin/env node

import { glob, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compareClaims } from "./tools/compare.js";
import { extractClaims } from "./tools/extract.js";
import { parseDoc } from "./tools/parse.js";
import { reportConflicts } from "./tools/report.js";
import { verifyConflicts } from "./tools/verify.js";

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

  const documents = [];
  for (const file of files) {
    console.log(`- parse ${file}`);
    documents.push(await parseDoc(file));
  }

  const claims = documents.flatMap(extractClaims);
  const candidates = compareClaims(claims);
  const conflicts = verifyConflicts(candidates);
  const reportMarkdown = reportConflicts({ documents, claims, conflicts });

  const outDir = resolve("crossdoc-output");
  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(outDir, "review.md");
  await writeFile(reportPath, reportMarkdown, "utf8");

  console.log(`Claims: ${claims.length}`);
  console.log(`Conflicts: ${conflicts.filter((conflict) => conflict.status === "verified").length} verified / ${conflicts.length} total`);
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
