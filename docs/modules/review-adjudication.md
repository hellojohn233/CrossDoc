# Review Adjudication

Status: Implementation contract

## Purpose

CrossDoc checks whether the key data in a set of documents lines up. It is not a text-diff tool and it does not compare sentence chunks.

Two earlier designs got this wrong. The first split documents into sentences, paired the sentences that shared words, and scored each pair with a token-overlap ratio. That produced backwards results: two documents holding the *identical* sentence scored 1.0 and were reported as a verified conflict, while a real difference in a value was ranked no higher than two sentences that merely shared a clause. The second replaced that with a fixed pipeline — extract, align, adjudicate, verify, report — where every step, every prompt and every threshold lived in code.

The third design keeps what the second one got right (compare key data, not sentences) and moves the *procedure* out of the code.

## Where the procedure lives

```text
.agents/skills/consistency-review/SKILL.md      the review, end to end
.agents/skills/key-data-alignment/SKILL.md     what to collect, and how to write it down
.agents/skills/conflict-adjudication/SKILL.md  when two values really disagree
data/skills/<name>/SKILL.md                     the user's own domain skills
```

One agent loads `consistency-review`, which loads the other two in turn, and drives the tools itself. The skill is the procedure: the steps, the criteria for a conflict, the shape of a value, the requirement that a quote be copied verbatim. Changing what a review considers a conflict is a change to a Markdown file, not to a prompt constant in `src/`.

The review procedure is injected into the first turn rather than left to the model to load, so a review cannot run without it. The two child skills are still loaded by the agent, in order, because they are steps of the procedure rather than capabilities of their own. See [the skills contract](./skills.md).

What stays in code is capability and guardrail:

| | Lives in | Why |
|---|---|---|
| Which documents to read | skill | procedure |
| How to write a value | skill | procedure |
| When two values conflict | skill | procedure |
| Which keys exist | `src/core/key-data.ts` | one vocabulary, exposed to the skill by `list_key_vocabulary` |
| Lining documents up by key | `src/tools/align.ts` | pure function, testable without a model |
| Whether a finding is citable | `src/tools/verify.ts` | guardrail, not a step |
| Whether a verdict is well-formed | `src/tools/verify.ts` | guardrail, not a step |
| Which skills exist | `src/skills/loader.ts` | discovered from the disk, not listed in code |

The vocabulary lives in code so there is one copy of it. The skill reads it through a tool instead of restating it, so the two cannot drift apart.

## Where a domain skill enters

Between parsing the documents and collecting the key data, the procedure asks whether these documents belong to a particular domain and loads the matching domain skill if one does. The domain skill adds two things and nothing else:

- which key data that domain states, and
- what a difference in that domain means.

It does not change the procedure. A review with no domain skill runs the general way, on the built-in vocabulary — a missing domain skill is not a downgrade.

When a domain skill is loaded, its key list is the vocabulary the agent collects against: it does not ask `list_key_vocabulary` for the built-in list, and it collects the domain's own keys plus whatever else the documents state that no key covers, as a custom key in the same style. A domain skill therefore only has to add the keys it cares about — it does not have to enumerate every key the documents state.

This is a rule in the wording of `key-data-alignment` and of the `list_key_vocabulary` tool, not a branch in the code: `alignKeyData()` groups by the key string and never checks it against the built-in vocabulary, so a custom key aligns exactly like a built-in one.

The skills themselves are discovered rather than listed, and the review procedure is injected into the first turn rather than left to the model to load. See [the skills contract](./skills.md).

## The tools

| Tool | Arguments | Returns |
|---|---|---|
| `list_key_vocabulary` | none | the fixed key vocabulary |
| `align_key_data` | `items[]` — `{documentId, key, value, quote, page?}` | the groups, and the pairs whose values differ |
| `verify_conflicts` | `judgments[]` — `{candidateId, conflict, severity, confidence, summary, rationale}` | the conflicts that survived verification |
| `report_conflicts` | none | the Markdown report |

Two of these take far less than they used to.

`verify_conflicts` does not need the pairs: the pairs come from the last `align_key_data` call in the same run. `report_conflicts` takes nothing at all: it reports the key data and the conflicts the run has already produced.

This is not a convenience. Asking a model to echo a large payload back into the next tool call is a reliability problem, not a capability one: the first live run of the agent loop fed an empty conflict list into `report_conflicts`, got an empty report back, and called it again — five times and counting, with the review never finishing. A tool that reads the previous step's output from the session has no way to get that wrong.

## Guardrails

These are checks, not steps. They are deterministic, they never ask a second opinion about wording, and they live in code.

- **A quote that is not in the source text is dismissed.** The verdict can say whatever it likes; if the sentence it quotes cannot be found in the parsed document, the finding is dropped. An uncitable finding is worse than a missing one. (`src/tools/verify.ts`)
- **A verdict is normalized before it is used.** Model output arrives as free-form JSON: `confidence` can come back as `"92%"`, `severity` as a word the pipeline does not know, `conflict` as `"yes"`. `normalizeJudgment()` turns all of it into a verdict the pipeline can reason about, and drops a verdict that names no pair. (`src/tools/verify.ts`)
- **A tool cannot run past its limit.** `createToolCallGuard()` blocks a tool that is called more often than it can produce something new, and asks the run to end. Reading tools are allowed to repeat; `report_conflicts` is not. (`src/agent-guard.ts`)
- **A run cannot hang.** The review is cut short after ten minutes and reported anyway, with a note saying so. (`src/review-run.ts`)

## The run

```text
inspect_document × N -> parse_document × N -> render_scan_page × scan pages
   -> load_document_skill × 2 (the two steps of the review)
   -> list_key_vocabulary -> align_key_data -> verify_conflicts -> report_conflicts
```

Every scan-candidate page is read with the vision model before anything is compared. A page that was never read looks exactly like a page where the documents agree.

`src/review-run.ts` does not decide anything. It scopes the documents, injects the review procedure, collects what the tools returned, re-verifies the verdicts against the parsed source, and renders the report. The pairs it uses are the ones `align_key_data` returned, not the ones the model typed into the next call.

## Contract

`/api/review` streams NDJSON. One `{"type":"progress","stage":"<tool>"}` line per tool the agent starts, then one `{"type":"result", ...}` line.

```ts
type ReviewStage = "load_document_skill" | "inspect_document" | "parse_document"
  | "render_scan_page" | "save_scan_page_text" | "search_document"
  | "list_key_vocabulary" | "align_key_data" | "verify_conflicts" | "report_conflicts";

ReviewResult = {
  reviewId: string;
  documents: { id: string; title: string; pages: number; format: string; markdown: string; warnings: string[]; sourceUrl: string }[];
  claimCount: number;             // key data points extracted
  conflictCount: number;
  verifiedConflictCount: number;
  judgeSource: "model";           // which stage produced the verdicts
  stages: ReviewStage[];          // the tools the agent actually called
  warning?: string;               // present when the review degraded
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

The body only ever grew. `stages` and `judgeSource` were added; every field that existed before still means what it meant.

## Measured Behaviour

Three example contracts, MiniMax-M3.1-Flash as the main model, one live run per row:

| | Rules over sentences | Fixed pipeline | Skill-driven agent |
|---|---|---|---|
| Reported candidates | 28 | 5 | 4 |
| Reported as verified | 26 | 4 | 4 |
| Verified conflicts with identical quotes on both sides | 21 | 0 | 0 |
| Conflicts found | payment terms, contract value, effective date, counterparty | the same four | the same four |
| Chinese negation contradiction | never recalled | recalled and judged `high` | recalled and judged `high` |
| End to end | — | 12.2s | 31s |

The skill-driven run costs more wall-clock time than the fixed pipeline, because the agent reads the documents itself and decides what to compare instead of a fixed script deciding it in advance. It is also the first design where the review can be changed without a release. Injecting the procedure rather than asking the model to load it took the run from 42s to 31s, because a tool call was removed from the path.

A live Chinese check through the same model found all three planted contradictions — 60 days against 90 days on payment, 人民币 100000 against 150000 on the contract value, 2026 年 3 月 1 日 against 2026 年 4 月 1 日 on the effective date — each with a Chinese rationale.

`scripts/verify-review-semantics.mjs` locks this behaviour with a scripted model, so the assertions do not depend on a model being available.
