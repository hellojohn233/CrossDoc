---
id: review-004
scope: skill-driven-review
depends_on: [review-003]
status: done
---

# review-004: Skill-driven review

## Objective

Move the consistency-review procedure out of the code and into skills, so that one agent reads the skill and drives the tools itself.

## Context

`review-003` got the unit of comparison right — key data instead of sentence chunks — but left the review as a fixed pipeline:

```text
parse -> extract key data -> align by key -> adjudicate -> verify -> report
```

Every step, every prompt and every threshold lived in `src/`. Changing what a review considers a conflict meant editing a prompt constant and shipping. The procedure was not readable on its own; it had to be reverse-engineered from the call order.

The agent was already there. It read documents, called `render_scan_page` for scan pages, and could judge contradictions itself. The pipeline was a second, parallel implementation of the same job — and the one the product actually used.

## Decision

The procedure moves into three skills under `.agents/skills/`, and one agent runs them:

| Skill | Owns |
|---|---|
| `consistency-review` | the review end to end: inspect, parse, read every scan page, align, adjudicate, report |
| `key-data-alignment` | what to collect per document, and how to write a value and a quote |
| `conflict-adjudication` | when two aligned values really disagree, how severe it is, how to report it |

The code keeps capability and guardrail only:

| Module | Owns |
|---|---|
| `src/core/key-data.ts` | the key vocabulary, exposed to the skill through `list_key_vocabulary` |
| `src/tools/align.ts` | lining documents up by key — pure functions |
| `src/tools/verify.ts` | whether a finding is citable, whether a verdict is well-formed — pure functions |
| `src/agent-guard.ts` | a tool cannot run past the number of times it can produce something new |
| `src/review-run.ts` | scoping the run, collecting what the tools returned, rendering the report |

The vocabulary stays in code so there is one copy of it; the skill reads it through a tool rather than restating it, so the two cannot drift apart.

## Scope

- Add `.agents/skills/consistency-review`, `key-data-alignment`, and `conflict-adjudication`.
- Add `list_key_vocabulary`, and change `align_key_data` to take the items the agent produced.
- Change `verify_conflicts` to take the verdicts only; the pairs come from the session.
- Change `report_conflicts` to take nothing; it reports what the run has already produced.
- Add `src/tools/review-session.ts`, the state the review tools share inside one run.
- Add `src/agent-guard.ts` and wire it as the agent's `beforeToolCall`.
- Add `src/review-run.ts`, which drives the agent and collects the run.
- Delete `src/review.ts`, `src/review-model.ts`, `src/tools/adjudicate.ts`, `src/tools/rule-adjudicate.ts`, `src/tools/rule-key-data.ts`, `src/tools/key-data.ts`, and the model's built-in `extract_key_data` tool.
- Stream `/api/review` as NDJSON, one progress line per tool the agent starts.
- Drop the fake progress timer in the review console and map the steps to the agent's real tool calls.
- Rewrite `scripts/verify-review-semantics.mjs` for the skill-driven run.

## Decisions that came out of the first live run

- **The model could not feed `report_conflicts` its own output.** The tool asked for the full conflict list as an argument, the model could not produce it, and the run looped on an empty report until it was cancelled. The tool now reads the previous step's output from the session. A tool that reads the session has no way to get that wrong; a tool that asks the model to repeat a payload does.
- **There is no turn limit in the runtime.** `pi-agent-core` has no `maxTurns` option, so the guard is a `beforeToolCall` hook that blocks a tool past its limit and asks the run to end. Reading tools get generous limits; the review tools get tight ones.
- **One dirty verdict field killed the whole review.** The model returned `confidence` as a string once, and `conflict.score.toFixed(2)` threw. The verdict is now normalized at the boundary, the report formatter tolerates a score that is not a number, and a report that cannot be rendered no longer discards the conflicts that were already found.
- **The skill's criteria were too broad in one direction.** The first skill said two documents talking about different parties is not a conflict, so the model dismissed the counterparty difference on the example corpus — the user had put three agreements side by side and one of them named a different client, which is exactly what they needed to be told. The skill now says that a different counterparty inside one review set is a conflict, and only values that answer different questions inside one engagement are not.

## Outcome

A live `POST /api/review` over the three example contracts, MiniMax-M3.1-Flash: 4 conflicts, all four verified, each reported once per key — counterparty, contract value, effective date, payment term. 42s end to end, and `report_conflicts` was called once.

A live Chinese check through the same model found all three planted contradictions, each with a Chinese rationale.

`scripts/verify-review-semantics.mjs` passes with sixteen checks, including two that fail a review which repeats `report_conflicts`: the guard stops the run and the conflicts that were already found are kept.

## Follow-up

- The review still needs a main model. There is no rule fallback any more: the whole point is that the procedure is a skill, and a skill needs an agent to read it.
- Key data is read from document text, so a value that only appears in a table may still be missed.
- The vocabulary is fixed, so custom keys still align by exact name only.
