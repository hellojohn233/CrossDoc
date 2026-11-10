/**
 * Turns the Markdown of a skill into HTML.
 *
 * A skill is read by people, not by machines, so the page shows it the way
 * it was written. The renderer is deliberately small: headings, paragraphs,
 * lists, quotes, code, rules, and the inline marks a skill actually uses.
 *
 * Everything is escaped before it is marked up, and a link is only kept when
 * its target is an ordinary web address. The text in a skill is the user's
 * own or the repository's, and a skill is still text that someone can type.
 */

const CODE_PLACEHOLDER = "\u0000code\u0000";

/** Escapes a value for use as HTML text. */
export function escapeMarkdownHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A link is only rendered when it points somewhere safe. */
function safeLinkTarget(target) {
  const trimmed = String(target ?? "").trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}

/** The inline marks: code, bold, italic, links. */
function renderInline(text) {
  const codeSpans = [];
  let working = text.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(`<code>${escapeMarkdownHtml(code)}</code>`);
    return `${CODE_PLACEHOLDER}${codeSpans.length - 1}\u0000`;
  });

  working = escapeMarkdownHtml(working);

  working = working.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, target) => {
    const safe = safeLinkTarget(target);
    if (!safe) return label;
    return `<a href="${escapeMarkdownHtml(safe)}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  working = working.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  working = working.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  working = working.replace(new RegExp(`${CODE_PLACEHOLDER}(\\d+)\\u0000`, "g"), (_match, index) => codeSpans[Number(index)] ?? "");
  return working;
}

/**
 * Renders Markdown as HTML.
 *
 * @param {string} source the Markdown
 * @returns {string} the HTML
 */
export function renderMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let index = 0;

  const closeList = (stack) => {
    while (stack.length > 0) html.push(`</${stack.pop()}>`);
  };

  const listStack = [];

  while (index < lines.length) {
    const line = lines[index];

    // A fenced code block.
    const fence = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fence) {
      closeList(listStack);
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const language = fence[1] ? ` class="language-${escapeMarkdownHtml(fence[1])}"` : "";
      html.push(`<pre><code${language}>${escapeMarkdownHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      closeList(listStack);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(listStack);
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList(listStack);
      html.push("<hr />");
      index += 1;
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList(listStack);
      const quoted = [quote[1]];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].match(/^\s*>\s?(.*)$/);
        if (!next) break;
        quoted.push(next[1]);
        index += 1;
      }
      html.push(`<blockquote><p>${renderInline(quoted.join("\n"))}</p></blockquote>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const tag = bullet ? "ul" : "ol";
      if (listStack[listStack.length - 1] !== tag) {
        closeList(listStack);
        listStack.push(tag);
        html.push(`<${tag}>`);
      }
      html.push(`<li>${renderInline((bullet ? bullet[1] : ordered[2]).trim())}</li>`);
      index += 1;
      continue;
    }

    closeList(listStack);
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^\s*([-*+]|\d+[.)]|#{1,6}\s|>|```)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  closeList(listStack);
  return html.join("\n");
}
