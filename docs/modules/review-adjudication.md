# Review Adjudication

Status: Implementation contract

## Purpose

Deciding whether two statements contradict each other is a semantic question. The review pipeline used to answer it with token overlap, which produced backwards results: two documents containing the *identical* sentence were reported as a verified conflict, while a genuine difference in a value was indistinguishable from a shared clause.

The pipeline is now split into three stages, and only the middle one is allowed to decide anything.

```text
parse -> extract -> recall -> adjudicate -> verify -> report
                    (rules)   (model)      (rules)
```

## Stage 1 — Recall (`src/tools/recall.ts`)

Cheap, deterministic, and never decisive. It answers one question: *which claim pairs deserve a semantic look?*

- Tokenization is language aware. Latin text becomes word tokens; CJK runs become character bigrams, so a Chinese sentence is comparable instead of a single token.
- Negation detection has no word boundaries for CJK terms (`不得`, `不应`, `禁止`, …) and uses word boundaries for Latin ones (`not`, `never`, `without`, …).
- Value extraction pulls numbers, dates, and amounts out of each statement.
- A pair is recalled when it carries a difference signal (opposite polarity, different number, date, or amount) *and* shares enough tokens, or when it shares enough tokens on its own.
- Two statements with identical wording are **not** recalled. Agreement is not a conflict.
- Statements from the same document are never compared with each other.

Output is a `CandidatePair`: two claims, a recall score, and the signals that explained the recall. The recall score is a heuristic and never leaks into a verdict.

## Stage 2 — Adjudication (`src/tools/adjudicate.ts`)

The semantic stage. A language model reads the original quote of both statements and answers whether they cannot both be true.

- Pairs are batched (8 by default), so a review costs a handful of requests instead of one per pair.
- The model answers with a JSON array of `{id, conflict, severity, confidence, summary, rationale}`. The parser tolerates prose and code fences around the array.
- A pair the model omits is treated as consistent, never as a conflict.
- `severity` is constrained to `low | medium | high`; `confidence` is clamped to 0..1.

`src/model-adjudicator.ts` wires this to the main model configured in Settings. The completion function is injected, so the module stays testable without a model runtime.

### Fallback

When no model is configured, or the model call fails, `src/tools/rule-adjudicate.ts` takes over. It only catches explicit contradictions (different dates, amounts, numbers, or opposite polarity) and never claims to understand paraphrases. The review still completes, and the response says which stage produced the verdicts.

## Stage 3 — Verification (`src/tools/verify.ts`)

Deterministic checks on the verdict, never a second opinion on the wording:

- A conflict whose evidence does not point back at its own claim is dismissed. An uncitable finding is worse than a missing one.
- `status` is `verified` only when the adjudicator said conflict *and* the evidence survived the check.
- `evidence` is exactly `[claims[0].evidence[0], claims[1].evidence[0]]`, so `evidence[i].id === claims[i].evidence[0].id` holds.

## Contract

The `/api/review` response body is unchanged apart from two additive fields.

```ts
ReviewResult = {
  documents: { id: string; title: string; sourceUrl?: string }[];
  claimCount: number;
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

`score` changed meaning: it used to be a token-overlap similarity that was then re-labelled as a verdict, which is why the ledger never renders it. It is now the adjudicator's confidence that the pair really contradicts.

## Agent Path

The agent judges contradictions itself. `compare_claims` returns recalled candidates and decides nothing; the agent reads both quotes and calls `verify_conflicts` with one judgment per candidate. The system prompt states the rule: a different number, date, amount, party, or an opposite permission is a conflict, while a paraphrase, a more specific restatement, or two statements about different subjects are not.

## Cost

Recall is O(n²) over claims and the current implementation compares every pair. For a small document set this is irrelevant; for a few thousand claims it is not. The recall pass is the only stage that needs an index (inverted index on rare tokens) or a blocking key.

## Measured Behaviour

Three example contracts, 29 extracted claims, MiniMax-M3.1-Flash as the main model:

| | Before (rules only) | After (recall + model) |
|---|---|---|
| Reported candidates | 28 | 13 |
| Reported as verified | 26 | 7 |
| Verified conflicts with identical quotes on both sides | 21 | 0 |
| Correctly detected contradictions | — | payment terms, contract value, effective date, counterparty |
| Chinese negation contradiction | never recalled | recalled and judged `high` |

`scripts/verify-review-semantics.mjs` locks the behaviour of all three stages with a stub adjudicator, so the assertions do not depend on a model.
