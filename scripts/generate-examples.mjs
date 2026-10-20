/**
 * Generate the example corpus in `examples/docs/`.
 *
 * The output is deterministic, so the committed files can always be rebuilt
 * with `npm run examples:generate`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTextPdf } from "./lib/pdf-fixture.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "..", "examples", "docs");

const EXAMPLES = [
  {
    file: "contract-a.pdf",
    lines: [
      "Master Services Agreement",
      ["Agreement between ", "Northwind Analytics ", "and Bright Harbor Ltd."],
      "Section 1. Scope of Services",
      "The Provider shall deliver the analytics platform described in Exhibit A.",
      "Section 2. Payment Terms",
      "The Client shall pay all undisputed invoices within 45 days of receipt.",
      "The total contract value is USD 120000 including delivery and support.",
      "Section 3. Confidentiality",
      "Each party shall maintain confidentiality of all disclosed information.",
      "Section 4. Term",
      "This Agreement takes effect on March 1, 2026 and continues for twelve months.",
    ],
  },
  {
    file: "contract-b.pdf",
    lines: [
      "Master Services Agreement",
      ["Agreement between ", "Northwind Analytics ", "and Bright Harbor Ltd."],
      "Section 1. Scope of Services",
      "The Provider shall deliver the analytics platform described in Exhibit A.",
      "Section 2. Payment Terms",
      "The Client shall pay all undisputed invoices within 90 days of receipt.",
      "The total contract value is USD 150000 including delivery and support.",
      "Section 3. Confidentiality",
      "Each party shall maintain confidentiality of all disclosed information.",
      "Section 4. Term",
      "This Agreement takes effect on April 1, 2026 and continues for twelve months.",
    ],
  },
  {
    file: "contract-c.pdf",
    lines: [
      "Master Services Agreement",
      ["Agreement between ", "Northwind Analytics ", "and Cedar Point Trading."],
      "Section 1. Scope of Services",
      "The Provider shall deliver the analytics platform described in Exhibit A.",
      "Section 2. Payment Terms",
      "The Client shall pay all undisputed invoices within 45 days of receipt.",
      "Section 3. Confidentiality",
      "Each party shall maintain confidentiality of all disclosed information.",
      "Section 4. Term",
      "This Agreement takes effect on March 1, 2026 and continues for twelve months.",
    ],
  },
];

await mkdir(outputDirectory, { recursive: true });

for (const example of EXAMPLES) {
  const target = resolve(outputDirectory, example.file);
  await writeFile(target, buildTextPdf(example.lines));
  console.log(`Wrote ${target}`);
}

console.log(`Generated ${EXAMPLES.length} example documents in ${outputDirectory}.`);
