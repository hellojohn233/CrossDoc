---
id: review-003
scope: key-data-alignment
depends_on: [review-002]
status: done
---

# review-003: Key data alignment

## Objective

Check whether the key data in a set of documents lines up, instead of comparing sentence chunks.

## Context

`review-002` moved the verdict to a language model, but the input to that model was still a pair of sentences matched by shared words. Two problems remained.

Recall needed the two sentences to share vocabulary. A contradiction written with different wording — 服务范围扩大了 against 服务范围缩小了 — was never recalled, so no model could have judged it. The same rule made two documents holding the identical sentence look maximally suspicious, and the 28 candidates on the example corpus included 21 pairs whose quotes were byte-identical.

The unit of comparison was also wrong for the product. CrossDoc is about whether key data lines up: does every agreement name the same counterparty, carry the same effective date, the same contract value. That question is asked of key data, not of sentences.

## Decision

The pipeline now runs on key data, and the model reads documents rather than pairs.

| Stage | Module | Who | What |
|---|---|---|---|
| Extract | `src/tools/key-data.ts` | model | which key data points a document asserts |
| Align | `src/tools/key-data.ts` | pure | line the documents up by key |
| Adjudicate | `src/tools/adjudicate.ts` | model | whether two aligned values contradict |
| Verify | `src/tools/verify.ts` | pure | whether the finding is citable |

The key comes from a fixed vocabulary in `src/core/key-data.ts`, so alignment no longer depends on shared wording: 付款期限 in one document and payment_term in another are the same key by construction. A key outside the vocabulary is kept and flagged.

Alignment is O(n) in key data points. There is no pairwise comparison of claims anywhere in the pipeline, so the recall cost that was recorded as a backlog item is gone.

## Scope

- Add `src/core/key-data.ts` with the key vocabulary, the key data types, and value normalization.
- Add `src/tools/key-data.ts` with the extraction prompt, the tolerant parser, and the pure alignment functions.
- Add `src/tools/rule-key-data.ts` and rewrite `src/tools/rule-adjudicate.ts` as the degraded path.
- Rewrite `src/tools/adjudicate.ts` to judge aligned pairs instead of recalled pairs.
- Rewrite `src/tools/verify.ts` to build conflicts from aligned pairs and to trace each quote back to its source blocks.
- Replace `src/model-adjudicator.ts` with `src/review-model.ts`, which owns both model-backed stages and their fallbacks.
- Rewire `src/review.ts`, the `/api/review` handler, and the CLI.
- Replace the `extract_claims` and `compare_claims` agent tools with `extract_key_data` and `align_key_data`; `verify_conflicts` now takes aligned pairs plus verdicts.
- Rewrite `scripts/verify-review-semantics.mjs` for the four stages.

## Decisions that came out of the first run

The first extraction pass produced noisy values, and each one needed a fix rather than a prompt tweak alone:

- **Granularity.** The model wrote `all undisputed invoices within 90 days of receipt` in one document and `45 days` in another, so the same key looked like two different values. The prompt now gives the good and the bad form of a value, and states that there is one item per key.
- **Splitting one fact into two items.** One document listed the counterparty as `Northwind Analytics` and `Bright Harbor Ltd.` while another listed `Northwind Analytics and Bright Harbor Ltd.`. One item per key now applies to the whole document, and the alignment keeps the most specific value per document and key.
- **Articles.** `the analytics platform described in Exhibit A` against `analytics platform described in Exhibit A` looked like a difference. Value normalization now ignores a leading article.
- **Thousands separators.** `USD 1,200.0` normalized to `usd 1 200 0`, because the comma was treated as punctuation. Normalization now strips digit-group separators and trailing zeros first.
- **Values with a currency prefix.** The rule fallback never found `USD 120000`, because the amount pattern only allowed a currency suffix.

## Outcome

`POST /api/review` over the three example contracts, 22 key data points, MiniMax-M3.1-Flash, 12.2s:

| | Rules over sentences | Key data alignment |
|---|---|---|
| Reported candidates | 28 | 5 |
| Reported as verified | 26 | 4 |
| Verified conflicts with identical quotes | 21 | 0 |

The four real contradictions are all found, and each is reported once per key rather than once per document pair: counterparty, contract value, effective date, payment term. The one dismissed candidate is a confidentiality clause stated at two levels of detail.

A Chinese check through the same model finds all three planted contradictions — 不得 against 可以 on the service scope, 60 days against 90 days on payment, 人民币 100000 against 150000 on the contract value — each with a Chinese rationale.

## Follow-up

- The key vocabulary is a fixed list, so a corpus that cares about data points outside it needs custom keys, and custom keys align by exact name only.
- The model is asked to extract key data from a document it reads as text, so a key that only appears in a table or a scanned page may be missed.
