/**
 * How the library groups and shows what it has stored.
 *
 * A document's identity is its content, but every upload is a fact worth
 * keeping: the same contract uploaded twice is two archived copies of one
 * document. The list shows one row per document and keeps the copies
 * underneath, so it says how many documents there are rather than how many
 * times they arrived.
 *
 * The functions here are pure: they take the library and give back the HTML
 * for it. Nothing here touches the DOM, so the whole rendering is checked
 * without a browser.
 */

/** Escapes a value for use in HTML text and attributes. */
export function escapeLibraryHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Groups archived documents by content.
 *
 * The oldest copy of a document is the primary one, because that is the copy
 * the references point at. A document without a content hash stands alone.
 *
 * @param {Array<{ id: string, sha256?: string, uploadedAt?: string }>} documents
 * @returns {Array<{ primary: object, copies: object[] }>}
 */
export function groupLibraryByContent(documents) {
  const groups = new Map();
  for (const document of documents ?? []) {
    const key = document.sha256 || `id:${document.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(document);
  }
  return [...groups.values()].map((entries) => {
    const sorted = [...entries].sort((left, right) => String(left.uploadedAt).localeCompare(String(right.uploadedAt)));
    return { primary: sorted[0], copies: sorted.slice(1) };
  });
}

/**
 * Counts how many documents share content with another one.
 *
 * @param {Array<{ id: string, sha256?: string }>} documents
 * @returns {Map<string, number>} content hash to the number of copies
 */
export function duplicateCountsByContent(documents) {
  const counts = new Map();
  for (const document of documents ?? []) {
    if (!document.sha256) continue;
    counts.set(document.sha256, (counts.get(document.sha256) ?? 0) + 1);
  }
  return counts;
}

/** A date, the way the library shows it. */
function libraryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

/** One archived document as a row. */
function libraryRow(document, options = {}) {
  const escape = options.escape ?? escapeLibraryHtml;
  const uploadedAt = libraryDate(document.uploadedAt);
  const lastUsedAt = document.lastUsedAt && document.lastUsedAt !== document.uploadedAt
    ? libraryDate(document.lastUsedAt)
    : "";
  const details = [document.format?.toUpperCase(), `${document.pages} 页`, uploadedAt]
    .filter(Boolean).join(" · ");
  const used = lastUsedAt ? ` · 最近使用 ${lastUsedAt}` : "";
  const picker = options.pickable
    ? `<label class="library-pick">
        <input type="checkbox" data-review-pick value="${escape(document.id)}" ${options.picked ? "checked" : ""} />
        <span class="visually-hidden">加入审查</span>
      </label>`
    : '<span class="library-pick"></span>';
  return `
    <article class="library-item${options.copy ? " library-copy" : ""}">
      ${picker}
      <div>
        <h3 class="library-item-title" title="${escape(document.title)}">${escape(document.title)}</h3>
        <p class="library-item-meta">${escape(details + used)}</p>
      </div>
      <div class="library-item-actions">
        <a href="${escape(document.sourceUrl)}" target="_blank" rel="noreferrer">打开源文件 ↗</a>
        <a href="${escape(document.markdownUrl)}" target="_blank" rel="noreferrer">查看 Markdown ↗</a>
      </div>
    </article>
  `;
}

/**
 * Renders the library as one row per document, with the copies of a document
 * underneath it.
 *
 * @param {Array<object>} documents the archived documents, newest first
 * @param {{ picked?: (id: string) => boolean }} options
 * @returns {string} the HTML for the library list
 */
export function renderLibraryGroups(documents, options = {}) {
  const list = Array.isArray(documents) ? documents : [];
  if (list.length === 0) return '<div class="library-empty">资料库还是空的</div>';
  const escape = options.escape ?? escapeLibraryHtml;
  const picked = options.picked ?? (() => false);
  const groups = groupLibraryByContent(list);
  const repeated = groups.filter((group) => group.copies.length > 0);
  const notice = repeated.length > 0
    ? `<p class="library-notice">${repeated.length} 组内容相同，共 ${list.length} 份归档。展开可以看到每一次归档。</p>`
    : "";

  return notice + groups.map((group, index) => {
    if (group.copies.length === 0) {
      return libraryRow(group.primary, { escape, pickable: true, picked: picked(group.primary.id) });
    }
    return `
      <section class="library-group" data-group="${index}">
        ${libraryRow(group.primary, { escape, pickable: true, picked: picked(group.primary.id) })}
        <button class="library-duplicates" type="button" data-library-group="${index}" data-library-count="${group.copies.length}" aria-expanded="false">
          另有 ${group.copies.length} 份相同内容 ▾
        </button>
        <div class="library-copies" data-library-copies="${index}" hidden>
          ${group.copies.map((copy) => libraryRow(copy, { escape, copy: true })).join("")}
        </div>
      </section>
    `;
  }).join("");
}
