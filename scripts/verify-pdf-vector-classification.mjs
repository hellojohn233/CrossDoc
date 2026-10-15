import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { getDocumentProxy } from "unpdf";

import { pdfLoader } from "../src/loaders/pdf.ts";

function makeVectorPdf() {
  const content = Buffer.from("72 72 468 648 re f", "ascii");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("\nendstream", "ascii"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let offset = chunks[0].length;

  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  }

  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
  ].join("");
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "ascii",
    ),
  );
  return Buffer.concat(chunks);
}

const directory = await mkdtemp(join(tmpdir(), "crossdoc-vector-page-"));
const sourcePath = join(directory, "vector.pdf");

try {
  await writeFile(sourcePath, makeVectorPdf());
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(sourcePath)));
  const operatorList = await (await pdf.getPage(1)).getOperatorList();
  const pathOperatorIndex = operatorList.fnArray.indexOf(OPS.constructPath);
  assert.notEqual(pathOperatorIndex, -1, "fixture should exercise PDF.js constructPath");
  assert.ok(
    [OPS.fill, OPS.eoFill, OPS.stroke, OPS.fillStroke, OPS.eoFillStroke].includes(
      operatorList.argsArray[pathOperatorIndex]?.[0],
    ),
    "constructPath should carry a visible paint operation",
  );

  const parsed = await pdfLoader.parse(sourcePath);
  assert.equal(parsed.pages[0]?.classification, "scan-candidate");
  assert.equal(parsed.pages[0]?.extractionMethod, "pending-vision");
  console.log("PASS: filled vector path is classified as scan-candidate");
} finally {
  await rm(directory, { recursive: true, force: true });
}
