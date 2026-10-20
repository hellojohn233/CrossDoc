/**
 * Group PDF text items into line-level blocks.
 *
 * PDF.js reports one text item per positioned run, which for many documents is
 * a single word. Storing one block per item produces an unusable Markdown
 * artifact (a footnote per word, with words cut in half) and breaks lexical
 * retrieval, because a multi-term query can never match inside one word.
 * This module groups items that share a text baseline into one line.
 *
 * The module is pure: it takes PDF.js text items and returns page text plus
 * line boundaries. It performs no I/O and depends on no PDF library.
 */

/** A positioned text run as reported by PDF.js (via unpdf). */
export interface PdfTextItem {
  str: string;
  /** Left edge of the run in PDF user space. */
  x: number;
  /** Text baseline in PDF user space. */
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  dir: string;
  /** PDF.js marks the last run of a line with this flag. */
  hasEOL: boolean;
}

/** One visual line of a page. */
export interface PageLine {
  /** The grouped run strings in reading order. */
  text: string;
  /** Character offsets of the line inside the page text. */
  start: number;
  end: number;
  /** Union of the grouped run bounding boxes, in PDF user space. */
  bbox: [number, number, number, number];
  /** Number of text runs that contributed to the line. */
  itemCount: number;
}

/** The reconstructed text of one page and its line boundaries. */
export interface PageText {
  /** Full page text. Lines are separated by a single newline. */
  text: string;
  lines: PageLine[];
}

/**
 * Maximum baseline drift, in PDF user units, that still counts as the same line.
 * Typical body line spacing is 10pt or more, so this never merges two lines;
 * it only absorbs sub/superscript and font-metric jitter within one line.
 */
export const BASELINE_TOLERANCE = 3.0;

function runBounds(item: PdfTextItem): [number, number, number, number] {
  return [
    Math.min(item.x, item.x + item.width),
    Math.min(item.y, item.y + item.height),
    Math.max(item.x, item.x + item.width),
    Math.max(item.y, item.y + item.height),
  ];
}

/**
 * Split the runs into visual lines. A line ends when PDF.js marks a line
 * break, when the next run sits on a different baseline, or when the writing
 * direction changes.
 */
function groupIntoLines(items: readonly PdfTextItem[]): PdfTextItem[][] {
  const groups: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [];

  for (const item of items) {
    const previous = current[current.length - 1];
    if (previous) {
      const baselineShift = Math.abs(item.y - previous.y) > BASELINE_TOLERANCE;
      if (previous.hasEOL || baselineShift || item.dir !== previous.dir) {
        groups.push(current);
        current = [];
      }
    }
    current.push(item);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Rebuild the page text from its runs and report the line boundaries.
 *
 * Every returned line is a contiguous slice of the returned text, so a block
 * can carry the exact offsets of its own content.
 */
export function buildPageText(items: readonly PdfTextItem[]): PageText {
  const lines: PageLine[] = [];
  let text = "";

  for (const group of groupIntoLines(items)) {
    const lineText = group.map((item) => item.str).join("");
    if (lineText.length === 0) continue;

    if (lines.length > 0) text += "\n";
    const start = text.length;
    text += lineText;
    const end = text.length;

    const bbox: [number, number, number, number] = [0, 0, 0, 0];
    let hasBounds = false;
    for (const item of group) {
      if (item.str.length === 0) continue;
      const bounds = runBounds(item);
      if (!hasBounds) {
        bbox[0] = bounds[0];
        bbox[1] = bounds[1];
        bbox[2] = bounds[2];
        bbox[3] = bounds[3];
        hasBounds = true;
        continue;
      }
      bbox[0] = Math.min(bbox[0], bounds[0]);
      bbox[1] = Math.min(bbox[1], bounds[1]);
      bbox[2] = Math.max(bbox[2], bounds[2]);
      bbox[3] = Math.max(bbox[3], bounds[3]);
    }

    lines.push({ text: lineText, start, end, bbox, itemCount: group.length });
  }

  return { text, lines };
}
