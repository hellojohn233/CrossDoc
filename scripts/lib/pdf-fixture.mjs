/**
 * Deterministic PDF fixtures shared by the verification scripts and the
 * example corpus generator.
 *
 * Every builder returns the same bytes for the same input, so generated
 * fixtures can be committed and regenerated at will.
 */

export function escapePdfText(value) {
  return value.replace(/([\\()])/g, "\\$1");
}

function assemblePdf(objects, rootReference = "1 0 R") {
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let offset = chunks[0].length;

  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const body = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "ascii");
    chunks.push(body);
    offset += body.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (const value of offsets.slice(1)) xref += `${String(value).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${rootReference} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "ascii"));

  return Buffer.concat(chunks);
}

function streamObject(content) {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

/**
 * Build a single-page PDF whose text is placed one run per line.
 *
 * A line may be given as a plain string (one text run) or as an array of
 * segments (several runs on the same baseline). The segmented form is what a
 * real producer emits for justified text, and it is what the line grouping
 * has to rebuild.
 */
export function buildTextPdf(lines, options = {}) {
  const {
    fontSize = 12,
    startY = 720,
    lineGap = 16,
    width = 612,
    height = 792,
    runSpacing = 160,
  } = options;

  const content = lines
    .map((line, index) => {
      const y = startY - index * lineGap;
      const segments = Array.isArray(line) ? line : [line];
      if (segments.length === 1) {
        return `BT /F1 ${fontSize} Tf 72 ${y} Td (${escapePdfText(segments[0])}) Tj ET`;
      }
      const runs = segments.map(
        (segment, segmentIndex) =>
          `1 0 0 1 ${72 + segmentIndex * runSpacing} ${y} Tm (${escapePdfText(segment)}) Tj`,
      );
      return `BT /F1 ${fontSize} Tf ${runs.join(" ")} ET`;
    })
    .join("\n");

  return assemblePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    streamObject(content),
  ]);
}

/**
 * Build a page that paints a filled rectangle and carries no selectable text,
 * which is how a scanned page looks to a PDF parser.
 */
export function buildVectorOnlyPdf(options = {}) {
  const { width = 612, height = 792 } = options;
  return assemblePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    streamObject("72 72 468 648 re f"),
  ]);
}
