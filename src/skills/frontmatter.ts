/**
 * Reads the front-matter block at the top of a Markdown file.
 *
 * The Agent Skills front-matter is a flat map of strings, so a full YAML parser
 * would be more than the format needs. A line that is not a `key: value` pair
 * is reported rather than guessed at, and an unterminated block is a warning
 * instead of a crash.
 */

export type Frontmatter = Record<string, string>;

export interface ParsedFrontmatter {
  /** The parsed key/value pairs. */
  frontmatter: Frontmatter;
  /** The Markdown body after the front-matter. */
  body: string;
  /** Anything about the block that could not be read cleanly. */
  warnings: string[];
}

const DELIMITER = "---";

/**
 * Parses the front-matter of a Markdown document.
 *
 * A document without a front-matter is not an error: it yields an empty map
 * and the whole document as the body. The caller decides whether that is
 * acceptable for the kind of document it is reading.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const warnings: string[] = [];
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, body: text.trim(), warnings };
  }

  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);
  if (closing === -1) {
    warnings.push("front-matter block is not terminated");
    return { frontmatter: {}, body: text.trim(), warnings };
  }

  const frontmatter: Frontmatter = {};
  for (const line of lines.slice(1, closing)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) {
      warnings.push(`front-matter line is not a key/value pair: ${line.trim()}`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (!key) {
      warnings.push(`front-matter line has no key: ${line.trim()}`);
      continue;
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body: lines.slice(closing + 1).join("\n").trim(), warnings };
}

/** Strips one layer of matching quotes, and unescapes what the quote style escapes. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}
