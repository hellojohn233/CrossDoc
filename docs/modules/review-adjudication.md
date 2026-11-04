# Review Adjudication

Status: Implementation contract

## Purpose

CrossDoc checks whether the key data in a set of documents lines up. It is not a text-diff tool and it does not compare sentence chunks.

The pipeline used to work that way anyway. It split documents into sentences, paired the sentences that shared words, and scored each pair with a token-overlap ratio. That produced backwards results: two documents holding the *identical* sentence scored 1.0 and were reported as a verified conflict, while a real difference in a value was ranked no higher than two sentences that merely shared a clause. A contradiction expressed with entirely different wording was never even recalled, because recall required shared words.

The pipeline now works on the thing the product is actually about: key data.

## Pipeline

```text
parse -> extract key data -> align by key -> adjudicate -> verify -> report
                 (model)      (pure)        (model)      (pure)
```

## Stage 1 — Key data extraction (`src/tools/key-data.ts`)

The model reads one document and lists the key data points it asserts. One request per document, so the cost scales with the number of documents, not with the number of pairs.

```json
{ "key": "payment_term", "value": "45 days", "quote": "The Client shall pay all undisputed invoices within 45 days of receipt.", "page": 1 }
```

The key comes from a fixed vocabulary (`src/core/key-data.ts`). The model picks the closest key that fits, so two documents that assert the same kind of data land on the same key even when they share no wording. A key outside the vocabulary is kept and flagged as custom.

The value is required to be the value itself, not the sentence around it. The prompt gives both the good and the bad form, because granularity is the main source of noise here: `90 days`, not `within 90 days of receipt`.

Documents are chunked by page into requests of at most 12,000 characters. Documents are extracted in parallel.

## Stage 2 — Alignment (`src/tools/key-data.ts`)

Pure functions, no model.

- One item per document per key. When a document states several values for a key, the most specific one is kept, so a group never crosses the same two documents twice.
- Values are normalized before comparison: punctuation, thousands separators, trailing zeros and leading articles are ignored, so `USD 1,200.0` and `usd 1200` are the same value and `45 days` and `90 days` are not.
- A group where every document states the same value produces nothing.
- A group where the values differ produces one pair per differing value combination, and each pair carries the whole group so the verdict sees what every document said.

Alignment is O(n) in key data points. There is no pairwise comparison of claims anywhere in the pipeline.

## Stage 3 — Adjudication (`src/tools/adjudicate.ts`)

The model reads the two values, both quotes, and the values the other documents state for the same key, and answers whether they cannot both be right.

- Pairs are batched, eight by default.
- The model answers with a JSON array of `{id, conflict, severity, confidence, summary, rationale}`. The parser tolerates prose and code fences around the array.
- `severity` is constrained to `low | medium | high`; `confidence` is clamped to 0..1.
- A pair the model omits is treated as consistent, never as a conflict.

## Stage 4 — Verification (`src/tools/verify.ts`)

Deterministic checks on the verdict, never a second opinion on the wording:

- A conflict whose evidence is missing, empty, or points at another document is dismissed. An uncitable finding is worse than a missing one.
- `status` is `verified` only when the adjudicator said conflict *and* the evidence survived the check.
- `evidence` is exactly `[claims[0].evidence[0], claims[1].evidence[0]]`, so `evidence[i].id === claims[i].evidence[0].id` holds.
- Each claim carries the source blocks of the page its quote came from, so a finding stays traceable in the Markdown report.

## Fallback

When no model is configured, or a model call fails, `src/tools/rule-key-data.ts` and `src/tools/rule-adjudicate.ts` take over. They recognise a fixed set of patterns (amounts, payment periods, dates, the parties, the governing law) and report every key whose value differs. They never claim to understand wording. The review still completes, and the response says which stage produced the result.

## Contract

The `/api/review` response body is unchanged apart from two additive fields.

```ts
ReviewResult = {
  documents: { id: string; title: string; sourceUrl?: string }[];
  claimCount: number;             // key data points extracted
  conflictCount: number;
  verifiedConflictCount: number;
  judgeSource: "model" | "rule";   // which stage produced the verdicts
  warning?: string;                // present when the review degraded
  conflicts: Conflict[];
  reportMarkdown: string;
};

Conflict = {
  id: string;
  status: "verified" | "dismissed";
  severity: "high" | "medium" | "low";
  summary: string;
  rationale: string;
  score: number;                   // adjudicator confidence (0-1), not a similarity
  judgeSource?: "model" | "rule";
  claims: [Claim, Claim];
  evidence: EvidenceSpan[];
};
```

`claimCount` counts key data points rather than sentences. `score` is the adjudicator's confidence that the pair really contradicts.

## Agent Path

The agent judges contradictions itself. `extract_key_data` returns what a document states, `align_key_data` lines the documents up and returns the values that disagree, and the agent passes its own verdicts to `verify_conflicts` as `{candidateId, conflict, severity, confidence, summary, rationale}`. The system prompt states the rule: a different number, date, amount, party, or jurisdiction is a conflict, while the same value written differently, a more specific restatement, or two values about different subjects are not.

## Measured Behaviour

Three example contracts, 22 key data points extracted, MiniMax-M3.1-Flash as the main model, 12.2s end to end:

| | Before (rules over sentences) | After (key data alignment) |
|---|---|---|
| Reported candidates | 28 | 5 |
| Reported as verified | 26 | 4 |
| Verified conflicts with identical quotes on both sides | 21 | 0 |
| Conflicts found | payment terms, contract value, effective date, counterparty | payment terms, contract value, effective date, counterparty |
| Chinese negation contradiction | never recalled | recalled and judged `high` |

The four real contradictions in the corpus are all found, and each is reported once per key rather than once per document pair. The one dismissed candidate is a confidentiality clause stated at two levels of detail, which the model correctly called compatible.

`scripts/verify-review-semantics.mjs` locks the behaviour of all four stages with a stub adjudicator, so the assertions do not depend on a model.
