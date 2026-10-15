import { readFile } from "node:fs/promises";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

const RENDER_SCALE = 1.5;
const MAX_RENDERED_SIDE = 4_500;

export type PdfPageRenderErrorCode = "INVALID_PAGE" | "PAGE_TOO_LARGE" | "INVALID_SOURCE" | "RENDER_FAILED";

export class PdfPageRenderError extends Error {
  constructor(
    readonly code: PdfPageRenderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PdfPageRenderError";
  }
}

export interface RenderedPdfPage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Render one PDF page at 1.5x, respecting its CropBox and page rotation. */
export async function renderPdfPage(path: string, pageNumber: number): Promise<RenderedPdfPage> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new PdfPageRenderError("INVALID_PAGE", `Page number must be a positive integer; received ${pageNumber}.`);
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes = await readFile(path);
  } catch (cause) {
    throw new PdfPageRenderError("INVALID_SOURCE", `Could not read PDF source: ${path}`, { cause });
  }

  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  } catch (cause) {
    throw new PdfPageRenderError("INVALID_SOURCE", `Could not open PDF source: ${path}`, { cause });
  }

  try {
    if (pageNumber > pdf.numPages) {
      throw new PdfPageRenderError(
        "INVALID_PAGE",
        `Page ${pageNumber} is outside this PDF's page range (1-${pdf.numPages}).`,
      );
    }

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const expectedWidth = Math.ceil(viewport.width);
    const expectedHeight = Math.ceil(viewport.height);
    const expectedLongSide = Math.max(expectedWidth, expectedHeight);
    if (expectedLongSide > MAX_RENDERED_SIDE) {
      throw new PdfPageRenderError(
        "PAGE_TOO_LARGE",
        `Page ${pageNumber} would render at ${expectedWidth}×${expectedHeight}px; the maximum side is ${MAX_RENDERED_SIDE}px.`,
      );
    }

    const rendered = await renderPageAsImage(pdf, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: RENDER_SCALE,
    });
    const bytes = new Uint8Array(rendered);
    const { width, height } = readPngDimensions(bytes, pageNumber);
    if (Math.max(width, height) > MAX_RENDERED_SIDE) {
      throw new PdfPageRenderError(
        "RENDER_FAILED",
        `Rendered page ${pageNumber} exceeded the ${MAX_RENDERED_SIDE}px side limit (${width}×${height}px).`,
      );
    }

    return { bytes, width, height };
  } catch (cause) {
    if (cause instanceof PdfPageRenderError) throw cause;
    throw new PdfPageRenderError("RENDER_FAILED", `Could not render PDF page ${pageNumber}.`, { cause });
  } finally {
    await pdf.cleanup();
  }
}

function readPngDimensions(bytes: Uint8Array, pageNumber: number): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const hasSignature = signature.every((value, index) => bytes[index] === value);
  if (!hasSignature || bytes.length < 24) {
    throw new PdfPageRenderError("RENDER_FAILED", `Rendered page ${pageNumber} did not produce a valid PNG.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) {
    throw new PdfPageRenderError("RENDER_FAILED", `Rendered page ${pageNumber} has invalid PNG dimensions.`);
  }
  return { width, height };
}
