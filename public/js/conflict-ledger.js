/**
 * 冲突清单（Conflict Ledger）前端组件。
 *
 * 分两层，互不依赖：
 *   1. 纯函数层 —— 不碰 DOM，可被 scripts/verify-conflict-diff.mjs 直接单测。
 *   2. 渲染层 —— 只吃传入的数据，不读任何全局变量，不发请求。
 *
 * 后端契约（与 POST /api/review 返回体一致，前端只依赖这一层）：
 *   {
 *     documents:  [{ id, title, sourceUrl? }],
 *     claimCount: number,
 *     conflictCount: number,
 *     reportMarkdown: string,
 *     conflicts: Conflict[]
 *   }
 *   Conflict = {
 *     id, status: "candidate" | "verified" | "dismissed",
 *     severity: "high" | "medium" | "low",
 *     summary, rationale, score,
 *     claims: [Claim, Claim],
 *     evidence: EvidenceSpan[]
 *   }
 *   Claim.evidence[0] = { id, documentId, page, quote, sourceBlocks }
 *
 * 换真实接口时只需要换调用方的那一行 fetch，组件本身不用动。
 */

/* ------------------------------------------------------------------ *
 * 纯函数层
 * ------------------------------------------------------------------ */

const CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/** 中文按字切、拉丁按词切，其余按单个非空白字符切。返回带尾随空白的 token。 */
export function splitTokens(text) {
  const source = String(text ?? "");
  const pattern =
    /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]|[A-Za-z0-9]+(?:[.,][A-Za-z0-9]+)*\.?|[^\s])(\s*)/g;
  const tokens = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tokens.push({ text: match[1], trail: match[2] ?? "" });
  }
  return tokens;
}

function tokenKey(token) {
  return token.text.toLowerCase();
}

/** 合并相邻的同类型片段，避免高亮块碎成一片。 */
function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) {
      last.text += segment.text;
      continue;
    }
    merged.push({ type: segment.type, text: segment.text });
  }
  return merged;
}

/**
 * 逐 token 对比两段文本。
 * @returns {{ left: Segment[], right: Segment[], identical: boolean }}
 */
export function diffTokens(leftText, rightText) {
  const left = splitTokens(leftText);
  const right = splitTokens(rightText);
  const rows = left.length;
  const cols = right.length;

  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        tokenKey(left[i]) === tokenKey(right[j])
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const leftSegments = [];
  const rightSegments = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (tokenKey(left[i]) === tokenKey(right[j])) {
      leftSegments.push({ type: "same", text: left[i].text + left[i].trail });
      rightSegments.push({ type: "same", text: right[j].text + right[j].trail });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      leftSegments.push({ type: "diff", text: left[i].text + left[i].trail });
      i += 1;
    } else {
      rightSegments.push({ type: "diff", text: right[j].text + right[j].trail });
      j += 1;
    }
  }
  while (i < rows) {
    leftSegments.push({ type: "diff", text: left[i].text + left[i].trail });
    i += 1;
  }
  while (j < cols) {
    rightSegments.push({ type: "diff", text: right[j].text + right[j].trail });
    j += 1;
  }

  return {
    left: mergeSegments(leftSegments),
    right: mergeSegments(rightSegments),
    identical:
      rows === cols && leftSegments.every((segment) => segment.type === "same"),
  };
}

/** 抽出日期，先做，避免日期里的数字被当成独立数值。 */
export function extractValues(text) {
  const source = String(text ?? "");
  const values = [];
  const datePattern =
    /(\d{4}\s*[年\-/.]\s*\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*日?)|(\d{1,2}\s*月\s*\d{1,2}\s*日)/g;
  const masked = source.replace(datePattern, (raw) => " ".repeat(raw.length));
  let dateMatch;
  while ((dateMatch = datePattern.exec(source)) !== null) {
    const raw = dateMatch[0].trim();
    const parts = raw.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
    values.push({
      kind: "date",
      raw,
      value: parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : raw,
      unit: "",
      index: dateMatch.index,
    });
  }

  const numberPattern =
    /(\d+(?:[.,]\d+)*)\s*(%|个工作日|个月|季度|天|日|年|月|小时|万元|美元|美金|人民币|元|USD|RMB|[Dd]ays?|[Mm]onths?|[Yy]ears?|[Hh]ours?|percent)?/g;
  let numberMatch;
  while ((numberMatch = numberPattern.exec(masked)) !== null) {
    const raw = numberMatch[0].trim();
    if (!raw) continue;
    values.push({
      kind: "number",
      raw,
      value: Number(numberMatch[1].replace(/,/g, "")),
      unit: numberMatch[2] ?? "",
      index: numberMatch.index,
    });
  }

  return values.sort((a, b) => a.index - b.index);
}

const POLARITY_MARKERS = [
  { marker: "without", kind: "prohibit" },
  { marker: "never", kind: "prohibit" },
  { marker: "shall not", kind: "prohibit" },
  { marker: "must not", kind: "prohibit" },
  { marker: "no", kind: "prohibit" },
  { marker: "not", kind: "prohibit" },
  { marker: "不得", kind: "prohibit" },
  { marker: "不能", kind: "prohibit" },
  { marker: "不应", kind: "prohibit" },
  { marker: "无需", kind: "prohibit" },
  { marker: "不会", kind: "prohibit" },
  { marker: "禁止", kind: "prohibit" },
  { marker: "严禁", kind: "prohibit" },
  { marker: "未", kind: "prohibit" },
  { marker: "非", kind: "prohibit" },
  { marker: "不", kind: "prohibit" },
  { marker: "must", kind: "require" },
  { marker: "shall", kind: "require" },
  { marker: "should", kind: "require" },
  { marker: "必须", kind: "require" },
  { marker: "应当", kind: "require" },
  { marker: "须", kind: "require" },
  { marker: "应", kind: "require" },
  { marker: "may", kind: "allow" },
  { marker: "can", kind: "allow" },
  { marker: "可以", kind: "allow" },
  { marker: "允许", kind: "allow" },
  { marker: "有权", kind: "allow" },
  { marker: "可", kind: "allow" },
];

const POLARITY_PATTERN = new RegExp(
  POLARITY_MARKERS.map((entry) => entry.marker).join("|"),
  "gi",
);

/** 找出语气极性词（禁止 / 要求 / 允许）。长词优先，避免 "不得" 被 "不" 抢先命中。 */
export function detectPolarity(text) {
  const source = String(text ?? "");
  const found = [];
  POLARITY_PATTERN.lastIndex = 0;
  let match;
  while ((match = POLARITY_PATTERN.exec(source)) !== null) {
    const marker = match[0];
    const entry = POLARITY_MARKERS.find(
      (candidate) => candidate.marker.toLowerCase() === marker.toLowerCase(),
    );
    if (!entry) continue;
    found.push({ marker, kind: entry.kind, index: match.index });
  }
  return found;
}

export function claimText(claim) {
  return claim?.text ?? claim?.value ?? claim?.summary ?? "";
}

export function claimQuote(claim) {
  return claim?.evidence?.[0]?.quote ?? claimText(claim);
}

/**
 * 判断一条冲突到底是什么类型的差异，并生成人话标题 + 差异信号。
 * @returns {{ kind: string, title: string, signals: Array<{type:string,text:string}>, diff: object, polarity: object }}
 */
export function describeConflict(conflict) {
  const claims = conflict?.claims ?? [];
  const leftQuote = claimQuote(claims[0]);
  const rightQuote = claimQuote(claims[1]);
  const diff = diffTokens(leftQuote, rightQuote);

  const leftValues = extractValues(leftQuote);
  const rightValues = extractValues(rightQuote);
  const leftPolarity = detectPolarity(leftQuote);
  const rightPolarity = detectPolarity(rightQuote);

  const signals = [];
  let kind = "text";
  let title = "表述不一致";

  if (diff.identical) {
    kind = "identical";
    title =
      leftQuote.trim() === rightQuote.trim()
        ? "两侧逐字一致"
        : "仅有大小写或标点差异";
  } else {
    const leftKinds = new Set(leftPolarity.map((item) => item.kind));
    const rightKinds = new Set(rightPolarity.map((item) => item.kind));
    const opposite =
      (leftKinds.has("prohibit") && rightKinds.has("allow")) ||
      (leftKinds.has("allow") && rightKinds.has("prohibit"));
    if (opposite) {
      kind = "polarity";
      const leftWord = leftPolarity.find((item) => item.kind === "prohibit" || item.kind === "allow")?.marker ?? "";
      const rightWord = rightPolarity.find((item) => item.kind === "prohibit" || item.kind === "allow")?.marker ?? "";
      title = `要求相反：一侧「${leftWord}」/ 一侧「${rightWord}」`;
      signals.push({ type: "polarity", text: `一禁止一允许：${leftWord} ↔ ${rightWord}` });
    }

    const leftDate = leftValues.find((item) => item.kind === "date");
    const rightDate = rightValues.find((item) => item.kind === "date");
    if (leftDate && rightDate) {
      if (leftDate.value === rightDate.value) {
        kind = "text";
        title = `同一日期的两种写法：${leftDate.raw} ↔ ${rightDate.raw}`;
        signals.push({
          type: "text",
          text: `同一日期的两种写法：${leftDate.raw} / ${rightDate.raw}`,
        });
      } else if (kind === "text") {
        kind = "value";
        title = `日期不一致：${leftDate.raw} ↔ ${rightDate.raw}`;
        signals.push({ type: "value", text: `日期 ${leftDate.raw} ↔ ${rightDate.raw}` });
      }
    }

    const leftNumber = leftValues.find((item) => item.kind === "number");
    const rightNumber = rightValues.find((item) => item.kind === "number");
    if (leftNumber && rightNumber && leftNumber.value !== rightNumber.value) {
      if (kind === "text") {
        kind = "value";
        title = `数值不一致：${leftNumber.raw} ↔ ${rightNumber.raw}`;
      }
      signals.push({
        type: "value",
        text: `${leftNumber.raw} ↔ ${rightNumber.raw}`,
      });
    } else if (kind === "text" && signals.length === 0) {
      const leftDiff = diff.left.filter((segment) => segment.type === "diff");
      const rightDiff = diff.right.filter((segment) => segment.type === "diff");
      const sample = leftDiff[0]?.text?.trim() ?? "";
      if (sample) {
        title = `表述不一致：「${sample}」↔ 「${rightDiff[0]?.text?.trim() ?? ""}」`;
      }
    }

    if (kind === "text" && signals.length === 0) {
      const changed = diff.left.filter((segment) => segment.type === "diff").length;
      signals.push({ type: "text", text: `${changed} 处措辞差异` });
    }
  }

  if (kind === "identical") {
    signals.push({ type: "text", text: title });
  }

  return {
    kind,
    title,
    signals,
    diff,
    polarity: { left: leftPolarity, right: rightPolarity },
  };
}

/** 冲突严重度排序权重。 */
export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * 把后端返回体转成视图模型。纯数据，不含 DOM。
 * @param {object} review 后端契约对象
 */
export function buildLedgerModel(review) {
  const conflicts = review?.conflicts ?? [];
  const documents = review?.documents ?? [];
  const titleById = new Map(documents.map((doc) => [doc.id, doc.title ?? doc.id]));

  const toItem = (conflict) => {
    const description = describeConflict(conflict);
    const claims = conflict.claims ?? [];
    const evidenceList = conflict.evidence ?? [];

    const locate = (anchor) => {
      if (!anchor) return { item: null, index: -1 };
      let index = evidenceList.findIndex((entry) => entry.id === anchor.id);
      if (index < 0) {
        index = evidenceList.findIndex(
          (entry) => entry.documentId === anchor.documentId && entry.page === anchor.page,
        );
      }
      if (index < 0) return { item: anchor, index: -1 };
      return { item: evidenceList[index], index };
    };

    const sides = ["A", "B"].map((tag, index) => {
      const claim = claims[index];
      const anchor = claim?.evidence?.[0];
      const { item: evidence } = locate(anchor);
      return {
        tag,
        documentId: claim?.documentId ?? evidence?.documentId ?? "",
        documentTitle: titleById.get(claim?.documentId ?? evidence?.documentId) ?? "未知文档",
        page: anchor?.page ?? evidence?.page ?? null,
        quote: claimQuote(claim),
        segments: index === 0 ? description.diff.left : description.diff.right,
        evidenceId: evidence?.id ?? null,
        sourceBlocks: evidence?.sourceBlocks ?? [],
      };
    });

    return {
      id: conflict.id,
      status: conflict.status,
      severity: conflict.severity,
      title: description.title,
      kind: description.kind,
      signals: description.signals,
      changeCount: Math.max(
        description.diff.left.filter((segment) => segment.type === "diff").length,
        description.diff.right.filter((segment) => segment.type === "diff").length,
      ),
      rationale: conflict.rationale ?? "",
      sides,
      evidence: evidenceList.map((entry, index) => ({
        label: `E${index + 1}`,
        evidenceId: entry.id,
        documentId: entry.documentId,
        documentTitle: titleById.get(entry.documentId) ?? entry.documentId ?? "未知文档",
        page: entry.page ?? null,
      })),
    };
  };

  const items = conflicts.map(toItem).sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    return String(a.id).localeCompare(String(b.id));
  });

  const pending = items.filter((item) => item.status === "verified");
  const dismissed = items.filter((item) => item.status !== "verified");

  return {
    stats: {
      documents: documents.length,
      claims: review?.claimCount ?? review?.claims?.length ?? 0,
      total: items.length,
      pending: pending.length,
      dismissed: dismissed.length,
    },
    groups: [
      { key: "pending", label: "待处理", items: pending },
      { key: "dismissed", label: "已排除", items: dismissed },
    ],
    documents,
  };
}

/* ------------------------------------------------------------------ *
 * 渲染层 v6 —— 单栏台账
 *
 * 一栏到底：清单条目自带 A/B 对照与证据，不再左右分栏。
 * 规范来源：awesome-design-md / claude + wired + theverge 的 DESIGN.md
 * ------------------------------------------------------------------ */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEVERITY_LABEL = { high: "高危", medium: "中危", low: "低危" };
const STATUS_LABEL = { verified: "已验证", dismissed: "已排除", candidate: "待定" };
function renderSegments(segments, tag) {
  return (segments ?? [])
    .map((segment) =>
      segment.type === "diff"
        ? `<${tag}>${escapeHtml(segment.text)}</${tag}>`
        : escapeHtml(segment.text),
    )
    .join("");
}

function renderSide(side, tag) {
  return `
    <div class="entry-side">
      <span class="side-tag">${escapeHtml(tag)}</span>
      <div class="side-body">
        <p class="side-label">
          <span class="side-doc">${escapeHtml(side.documentTitle)}</span>
          <span class="side-page mono">P${escapeHtml(side.page ?? "?")}</span>
        </p>
        <p class="side-quote">${renderSegments(side.segments, tag === "A" ? "del" : "ins")}</p>
      </div>
    </div>
  `;
}

function renderEvidenceLinks(item) {
  if (!item.evidence || item.evidence.length === 0) return "";
  return `
    <div class="entry-evidence">
      <span class="evidence-label">证据</span>
      ${item.evidence
        .map(
          (entry) => `
            <button class="evidence-link" type="button" data-evidence-id="${escapeHtml(entry.evidenceId)}" data-page="${escapeHtml(entry.page ?? "")}" data-document-id="${escapeHtml(entry.documentId)}">
              <span class="ev-id mono">${escapeHtml(entry.label)}</span>
              <span class="ev-doc">${escapeHtml(entry.documentTitle)}</span>
              <span class="ev-page mono">P${escapeHtml(entry.page ?? "?")}</span>
              <span class="ev-open">打开 ↗</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

/** 一条冲突 = 一个完整条目：标题 + A/B 对照 + 判定 + 证据。 */
export function renderConflictEntry(item, { index = 0, selected = false } = {}) {
  const [left, right] = item.sides;
  return `
    <article class="ledger-entry ${escapeHtml(item.severity)} ${escapeHtml(item.status)}${selected ? " selected" : ""}" data-conflict-id="${escapeHtml(item.id)}">
      <div class="entry-gutter">
        <span class="entry-index mono">${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="entry-content">
        <header class="entry-head">
          <h3 class="entry-title">${escapeHtml(item.title)}</h3>
          <span class="entry-sev ${escapeHtml(item.severity)}">${escapeHtml(SEVERITY_LABEL[item.severity] ?? item.severity)}</span>
        </header>
        <div class="entry-sides">
          ${renderSide(left, "A")}
          ${renderSide(right, "B")}
        </div>
        <footer class="entry-foot">
          ${
            item.rationale
              ? `<p class="entry-rationale"><span class="foot-label">判定</span>${escapeHtml(item.rationale)}</p>`
              : ""
          }
          ${renderEvidenceLinks(item)}
        </footer>
      </div>
    </article>
  `;
}

/**
 * 挂载冲突清单（单栏）。
 * @param {HTMLElement} root
 * @param {object} model buildLedgerModel 的结果
 * @param {{ onSelect?: Function, onOpenEvidence?: Function }} handlers
 */
export function mountLedger(root, model, handlers = {}) {
  const { onSelect, onOpenEvidence } = handlers;
  let activeGroup = model.groups[0]?.key ?? "pending";
  let selectedId = model.groups[0]?.items[0]?.id ?? null;
  let query = "";

  const findItem = (id) =>
    model.groups.flatMap((group) => group.items).find((item) => item.id === id) ?? null;

  const matches = (item) => {
    if (!query) return true;
    const haystack = [
      item.title,
      item.id,
      item.sides.map((side) => `${side.documentTitle} ${side.page ?? ""}`).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  };

  const paint = () => {
    const group = model.groups.find((entry) => entry.key === activeGroup) ?? model.groups[0];
    if (!group) return;
    const visible = group.items.filter(matches);
    if (!visible.some((item) => item.id === selectedId)) {
      selectedId = visible[0]?.id ?? null;
    }
    const stats = model.stats;

    root.innerHTML = `
      <header class="ledger-bar">
        <div class="ledger-bar-lead">
          <p class="ledger-eyebrow">Conflict Ledger</p>
          <h1>冲突清单</h1>
          <p class="ledger-bar-meta">
            ${escapeHtml(stats.documents)} 份文档 · ${escapeHtml(stats.claims)} claims ·
            <b>${escapeHtml(stats.pending)}</b> 待处理 · ${escapeHtml(stats.dismissed)} 已排除
          </p>
        </div>
        <div class="ledger-tools">
          <label class="ledger-search">
            <span class="search-icon" aria-hidden="true"></span>
            <input id="ledger-search" type="search" placeholder="搜索冲突 / 文档 / 页码" value="${escapeHtml(query)}" />
          </label>
          <div class="ledger-tabs" role="tablist" aria-label="冲突筛选">
            ${model.groups
              .map(
                (entry) =>
                  `<button class="ledger-tab ${entry.key === activeGroup ? "active" : ""}" type="button" role="tab" data-group="${escapeHtml(entry.key)}" aria-selected="${entry.key === activeGroup}">${escapeHtml(entry.label)} <span class="count">${escapeHtml(entry.items.length)}</span></button>`,
              )
              .join("")}
          </div>
        </div>
      </header>

      <div class="ledger-entries">
        ${
          visible.length === 0
            ? '<p class="empty">没有匹配的冲突。</p>'
            : visible
                .map((item, index) =>
                  renderConflictEntry(item, { index, selected: item.id === selectedId }),
                )
                .join("")
        }
      </div>
    `;

    const search = root.querySelector("#ledger-search");
    search?.addEventListener("input", (event) => {
      query = event.target.value.trim().toLowerCase();
      const cursor = event.target.selectionStart;
      paint();
      const next = root.querySelector("#ledger-search");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });

    root.querySelectorAll("[data-group]").forEach((button) => {
      button.addEventListener("click", () => {
        activeGroup = button.dataset.group;
        paint();
      });
    });

    root.querySelectorAll("[data-conflict-id]").forEach((entry) => {
      entry.addEventListener("click", () => {
        selectedId = entry.dataset.conflictId;
        paint();
      });
    });

    root.querySelectorAll("[data-evidence-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onOpenEvidence?.({
          evidenceId: button.dataset.evidenceId,
          documentId: button.dataset.documentId,
          page: Number(button.dataset.page) || null,
        });
      });
    });

    onSelect?.(findItem(selectedId));
  };

  paint();
  return {
    getSelectedId: () => selectedId,
    getSelected: () => findItem(selectedId),
    getActiveGroup: () => activeGroup,
    setGroup: (key) => {
      activeGroup = key;
      paint();
    },
    refresh: paint,
  };
}
