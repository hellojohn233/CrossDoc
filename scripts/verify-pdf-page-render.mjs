import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PdfPageRenderError, renderPdfPage } from "../src/loaders/render-pdf-page.ts";

function makePdf(pages) {
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`),
  ];

  for (const [index, page] of pages.entries()) {
    const pageObjectId = 3 + index * 2;
    const streamObjectId = pageObjectId + 1;
    const crop = page.cropBox ? `/CropBox [${page.cropBox.join(" ")}]` : "";
    const rotate = page.rotate ? `/Rotate ${page.rotate}` : "";
    objects.push(Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.mediaBox.join(" ")}] ${crop} ${rotate} /Resources << >> /Contents ${streamObjectId} 0 R >>`,
    ));
    objects.push(Buffer.from("<< /Length 0 >>\nstream\n\nendstream", "ascii"));
  }

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
  chunks.push(Buffer.from(
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    "ascii",
  ));
  return Buffer.concat(chunks);
}

const directory = await mkdtemp(join(tmpdir(), "crossdoc-pdf-render-"));
const sourcePath = join(directory, "crop-rotate-bounds.pdf");

try {
  await writeFile(sourcePath, makePdf([
    { mediaBox: [612, 792], cropBox: [20, 30, 500, 700] },
    { mediaBox: [612, 792], cropBox: [20, 30, 500, 700], rotate: 90 },
    { mediaBox: [5_000, 1_200], cropBox: [0, 0, 4_000, 1_000] },
  ]));

  const cropped = await renderPdfPage(sourcePath, 1);
  assert.deepEqual([cropped.width, cropped.height], [720, 1_005], "CropBox controls unrotated output dimensions");
  assert.deepEqual([...cropped.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "result is PNG data");

  const rotated = await renderPdfPage(sourcePath, 2);
  assert.deepEqual([rotated.width, rotated.height], [1_005, 720], "page rotation swaps cropped output dimensions");

  await assert.rejects(
    renderPdfPage(sourcePath, 3),
    (error) => error instanceof PdfPageRenderError && error.code === "PAGE_TOO_LARGE",
  );
  await assert.rejects(
    renderPdfPage(sourcePath, 4),
    (error) => error instanceof PdfPageRenderError && error.code === "INVALID_PAGE",
  );
  await assert.rejects(
    renderPdfPage(sourcePath, 0),
    (error) => error instanceof PdfPageRenderError && error.code === "INVALID_PAGE",
  );
  await assert.rejects(
    renderPdfPage(join(directory, "missing.pdf"), 1),
    (error) => error instanceof PdfPageRenderError && error.code === "INVALID_SOURCE",
  );

  console.log("PASS: page PNG bytes, CropBox, rotation, side bound, and invalid page contract");
} finally {
  await rm(directory, { recursive: true, force: true });
}
