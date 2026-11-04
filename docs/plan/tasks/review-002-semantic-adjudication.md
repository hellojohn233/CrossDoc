---
id: review-002
scope: semantic-conflict-adjudication
depends_on: [ui-002]
status: done
---

# review-002: Semantic conflict adjudication

> Superseded by [`review-003`](./review-003-key-data-alignment.md), which replaced the recall stage with key data alignment. This document records what was true at the time of this task.

## Objective

Decide whether two statements contradict each other with a language model, not with token overlap.

## Context

The review pipeline answered a semantic question with a mechanical heuristic. `compareClaims` scored a pair with `overlapScore`, a token-set overlap ratio, and `verifyConflicts` re-labelled that number as a verdict (`score >= 0.7` means verified). The score measures how *similar* two statements are, so the result was inverted in both directions:

- Two documents containing the identical sentence scored 1.0 and were reported as a verified conflict. On the example corpus, 21 of 28 reported conflicts had byte-identical quotes on both sides.
- A genuine difference in a value — 45 days versus 90 days — was indistinguishable from two statements that merely shared a clause.
- A Chinese negation contradiction was never recalled at all: `tokenSet` split on whitespace, so a whole Chinese sentence became one token and the overlap was ~0, and the negation pattern used `\b`, which never matches between two CJK characters.

The agent already had `compare_claims`, `verify_conflicts`, and `report_conflicts` registered as tools, but the tools called the same rule functions. The agent was a scheduler, not a judge.

## Decision

Split the pipeline into three stages, and let only the middle one decide.

| Stage | Module | Decides | Why |
|---|---|---|---|
| Recall | `src/tools/recall.ts` | which pairs to look at | cheap and deterministic; must never decide |
| Adjudicate | `src/tools/adjudicate.ts` | whether a pair contradicts | this is the semantic question |
| Verify | `src/tools/verify.ts` | whether the finding is citable | evidence integrity, not wording |

Rules the recall stage follows:

- CJK-aware tokenization: character bigrams for Chinese, word tokens for Latin.
- Negation detection without word boundaries for CJK terms.
- Numbers, dates, and amounts are extracted per statement, so a differing value becomes a recall signal.
- Identical wording is agreement, so it is never recalled.
- Same-document pairs are never compared.

The adjudication stage sends batches of eight candidate pairs to the main model configured in Settings and asks for a JSON verdict per pair. The completion function is injected, so the stage is testable without a model runtime. A pair the model omits is treated as consistent, never as a conflict.

The verification stage checks that each conflict still points at its own claim. A conflict whose evidence is missing or points at another document is dismissed, because an uncitable finding is worse than a missing one.

## Scope

- Replace `src/tools/compare.ts` with `src/tools/recall.ts`.
- Add `src/tools/adjudicate.ts` with the prompt builder, the tolerant JSON parser, and the batching loop.
- Add `src/tools/rule-adjudicate.ts` as the degraded path when no model is configured or the model call fails.
- Rewrite `src/tools/verify.ts` as an evidence validator.
- Add `src/model-adjudicator.ts` to wire the main model profile into the adjudicator.
- Rewire `src/review.ts` and the `/api/review` handler; add `judgeSource` and `warning` to the response.
- Change the agent path: `compare_claims` now returns candidates and decides nothing, and the agent passes its own verdicts to `verify_conflicts`.
- Drop the global flag from `DATE_PATTERN` and `MONEY_PATTERN` in `src/tools/extract.ts`; `inferKind` returned before resetting `lastIndex`, so a date sentence following another date sentence was classified as `fact`.
- Add `scripts/verify-review-semantics.mjs` with eleven assertions over all three stages.

## Outcome

`/api/review` on the three example contracts, 29 extracted claims, MiniMax-M3.1-Flash:

| | Before | After |
|---|---|---|
| Reported candidates | 28 | 13 |
| Reported as verified | 26 | 7 |
| Verified conflicts with identical quotes | 21 | 0 |
| Chinese negation contradiction | never recalled | recalled, judged `high` |

All four real contradictions in the corpus are found: payment terms (45 vs 90 days), contract value (USD 120000 vs 150000), effective date (March 1 vs April 1), and counterparty (Bright Harbor vs Cedar Point). The six dismissed candidates are headings and clauses that agree with each other.

The `/api/review` response body is unchanged apart from the additive `judgeSource` and `warning` fields, so the ledger needed no change.

## Follow-up

Recall is still O(n²) over claims. It is the only stage that needs an index once a corpus gets large. See `docs/plan/backlog.md`.
