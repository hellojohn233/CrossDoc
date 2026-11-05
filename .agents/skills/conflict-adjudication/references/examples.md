# Verdicts, worked

Optional depth for `conflict-adjudication`. The rules in `SKILL.md` decide the outcome; these examples show what each verdict looks like.

## A conflict

Two values that cannot both be right for the same subject and scope.

| Key | Document A | Document B | Verdict | Severity |
|---|---|---|---|---|
| `payment_term` | `45 days` | `90 days` | conflict | high |
| `contract_value` | `USD 120000` | `USD 150000` | conflict | high |
| `effective_date` | `March 1, 2026` | `April 1, 2026` | conflict | high |
| `service_scope` | `甲方不得单方面变更服务范围` | `甲方可以单方面变更服务范围` | conflict | medium |

## A different counterparty is a conflict

Document A says `Agreement between Northwind Analytics and Bright Harbor Ltd.` and document C says `Agreement between Northwind Analytics and Cedar Point Trading.` Both are in the same review set.

Verdict: **conflict**, severity `high` — who is bound changes. The reasoning is not "these must be separate engagements, so it is fine". The user put these documents side by side and asked whether they agree. One of them names a different client, and that is the answer they needed.

## Not a conflict

| Situation | Why |
|---|---|
| `45 days` against `within 45 days` | The same value written differently. The alignment normalizes this before it reaches you. |
| `all disclosed information` against `maintain confidentiality of all disclosed information` | One is more general, the other more specific, and they stay compatible. |
| A termination notice against a payment term | The two values answer different questions inside one engagement. The key does not decide the same thing in both. |
| A key only one document states | Nothing to contradict. |
| A clause that states no value | A shared clause is not key data. |

## Severity

| Severity | What changes |
|---|---|
| `high` | An amount, a deadline, or who is bound. |
| `medium` | A material term, but the deal survives the difference. |
| `low` | The difference is minor. |

## Confidence

`confidence` is how sure you are that the two values contradict, from 0 to 1. A pair where you are guessing is a `low` confidence, not a `true` verdict with high confidence. When you are not sure, say why in the rationale.
