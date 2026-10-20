import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pdfLoader } from "../src/loaders/pdf.ts";
import { searchDocument } from "../src/tools/search-document.ts";
import { buildTextPdf, buildVectorOnlyPdf } from "./lib/pdf-fixture.mjs";

const FIXTURE_LINES = [
  // Three segments on one baseline: PDF.js splits this into several runs.
  ["Master ", "Services ", "Agreement"],
  "Section 1. Scope of Services",
  "The Provider shall deliver the software platform within thirty (30) days.",
  "The Client shall pay all undisputed invoices within 45 days of receipt.",
  "Each party shall maintain confidentiality of all disclosed information.",
];

const SCAN_PAGE_FIXTURE = "The Provider shall deliver the software platform within thirty (30) days.";

function countFootnoteDefinitions(markdown) {
  return (markdown.match(/^\[\^src-\d+\]:/gm) ?? []).length;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "crossdoc-document-ingest-"));
  const textPath = join(root, "contract.pdf");
  const scanPath = join(root, "scanned.pdf");

  try {
    await writeFile(textPath, buildTextPdf(FIXTURE_LINES));
    const parsed = await pdfLoader.parse(textPath, { id: "ingest-doc", title: "contract.pdf" });
    const page = parsed.pages[0];

    // A1: one block per visual line, never one per word.
    assert.equal(parsed.blocks.length, FIXTURE_LINES.length, "each visual line becomes exactly one block");
    assert.deepEqual(
      parsed.blocks.map((block) => block.id),
      FIXTURE_LINES.map((_, index) => `ingest-doc:p1:b${index + 1}`),
      "block identifiers stay in page and line order",
    );
    assert.equal(page?.classification, "text-native");
    assert.equal(page?.extractionMethod, "native-text");
    assert.equal(
      parsed.text,
      FIXTURE_LINES.map((line) => (Array.isArray(line) ? line.join("") : line)).join("\n"),
      "the page text keeps one line of source text per visual line",
    );

    // A2: every block is a contiguous slice of the page text.
    for (const block of parsed.blocks) {
      assert.equal(page?.text.slice(block.start, block.end), block.text, `block ${block.id} is a contiguous slice of the page text`);
    }

    // A3: the Markdown keeps whole lines intact and footnotes them once per line.
    const definitions = countFootnoteDefinitions(parsed.markdown);
    assert.equal(definitions, parsed.blocks.length, "the Markdown carries one source note per line block");
    for (const block of parsed.blocks) {
      assert.ok(parsed.markdown.includes(block.text), `the Markdown keeps "${block.text}" intact instead of splitting it`);
    }
    const markdownWithoutNotes = parsed.markdown.replace(/\[\^src-\d+\]/g, "");
    assert.ok(
      markdownWithoutNotes.includes(page?.text ?? ""),
      "removing the source notes leaves the page text unbroken, so no word is split by a note",
    );
    assert.match(parsed.markdown, /Master Services Agreement\[\^src-1\]/);
    assert.match(parsed.markdown, /## Page 1/);

    // A4: a block box is the union of the runs it groups.
    const [first, second] = parsed.blocks;
    assert.ok(first && second, "the fixture produces at least two blocks");
    assert.ok(
      first.source.bbox[2] > second.source.bbox[2],
      "a multi-run line spans further right than a single-run line",
    );
    assert.ok(
      first.source.bbox[2] - first.source.bbox[0] > 300,
      "the first line box covers every run on that baseline, not only the first one",
    );
    for (const block of parsed.blocks) {
      assert.ok(Math.abs(block.source.bbox[0] - 72) < 0.01, "every line starts at the text origin");
      assert.ok(block.source.bbox[2] > block.source.bbox[0], "every line box has a positive width");
      assert.ok(block.source.bbox[3] > block.source.bbox[1], "every line box has a positive height");
    }

    // A5: a multi-term query now matches a whole line instead of missing.
    const search = searchDocument({ query: "undisputed invoices within 45 days", documents: [parsed] });
    assert.equal(search.status, "matches", "a multi-term query matches a line block");
    assert.equal(search.excerpts[0]?.source.blockId, "ingest-doc:p1:b4");
    assert.ok(
      search.excerpts[0]?.excerpt.includes("within 45 days"),
      "the retrieved excerpt keeps the surrounding sentence",
    );

    // A6: a page without selectable text is still a scan candidate.
    await writeFile(scanPath, buildVectorOnlyPdf());
    const scanned = await pdfLoader.parse(scanPath, { id: "scan-doc", title: "scanned.pdf" });
    assert.equal(scanned.pages[0]?.classification, "scan-candidate");
    assert.equal(scanned.pages[0]?.extractionMethod, "pending-vision");
    assert.equal(scanned.blocks.length, 0, "a scanned page contributes no native blocks");

    console.log("Document ingest checks passed (line-level blocks, contiguous offsets, readable Markdown, cross-line retrieval, scan classification).");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
