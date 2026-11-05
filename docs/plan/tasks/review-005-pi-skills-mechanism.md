---
id: review-005
scope: pi-skills-mechanism
depends_on: [review-004]
status: done
---

# review-005: The Pi skill mechanism

## Objective

Make CrossDoc use Pi's skill mechanism, not just the shape of a skill file.

## Context

`review-004` moved the review procedure out of the code and into `.agents/skills/`. The files were right; the mechanism around them was not.

Pi implements the [Agent Skills specification](https://agentskills.io/specification). Its loader lives in the coding-agent application layer (`packages/coding-agent/src/core/skills.ts`), and the published `@earendil-works/pi-agent-core` has no skill machinery at all — the embedded runtime has no automatic discovery, so CrossDoc has to supply its own. What Pi defines is worth copying: discovery rules, name validation, diagnostics, the progressive-disclosure index, `disable-model-invocation`, and the deterministic `/skill:name` invocation.

CrossDoc had four gaps against that.

- **The set of skills was written in code.** `SKILL_NAMES` was a literal union in `src/agent.ts`, and `load_document_skill` took a value from it. Adding a skill meant editing TypeScript, which is exactly what `review-004` set out to stop.
- **The model could not see what skills existed.** The system prompt named one skill in prose. Pi advertises every skill's name, description, and location, and lets the model route on the description.
- **Nothing validated a skill.** A malformed front-matter, a missing description, or two skills with one name produced no signal.
- **The review depended on the model remembering to load the procedure.** The first turn asked the agent to call `load_document_skill`, and a model that did not would produce an empty review with no error.

## Decision

Four mechanisms, in the order they matter.

### Discovery

`src/skills/loader.ts` walks `.agents/skills/` with Pi's rules: a directory holding `SKILL.md` is a skill root and is not searched further, and every other directory is searched for one. `description` is required and a skill without one is not loaded. Names are validated against the specification's rules, and the violations are diagnostics rather than failures.

`load_document_skill` now takes a free string. There is no list in the code to keep in step with the disk.

### Progressive disclosure

`formatSkillsForPrompt()` puts an XML index into the system prompt: name, description, location, one entry per visible skill. The bodies are loaded on demand.

### Deterministic invocation

`formatSkillInvocation()` produces the `<skill>` block an explicit invocation delivers. `runConsistencyReview()` injects the `consistency-review` body into the first turn. A review can no longer run without its procedure.

The two child skills keep `disable-model-invocation: true`, so they stay out of the index: the model cannot jump to `conflict-adjudication` instead of following the procedure. The parent names them, and the agent loads them in order.

### Bundled reference files

`read_skill_file` reads a file inside a skill directory, relative to it, with the path confined to that directory. The two review skills gained `references/examples.md` with worked examples of the values, quotes, and verdicts they decide on.

## Scope

- Add `src/skills/frontmatter.ts` and `src/skills/loader.ts`.
- Drop `SKILL_NAMES`, the literal union, and `skillPath()` from `src/agent.ts`; the skill parameter becomes a free string.
- Put the skills index into the system prompt.
- Change `load_document_skill` to return the `<skill>` block, and add `read_skill_file`.
- Inject the review procedure in `src/review-run.ts`.
- Add `disable-model-invocation` to the two child skills and `references/examples.md` to both.
- Add `scripts/verify-skills.mjs`.

## Outcome

A live `POST /api/review` over the three example contracts: 4 conflicts, all four verified, 31s. The agent loaded the two child skills in order and read both reference files. The Chinese check found all three planted contradictions in 32s.

Injecting the procedure took the run from 42s to 31s, because one tool call left the path.

`scripts/verify-skills.mjs` passes with thirteen checks, including two that prove discovery is real: a skill written into a temporary directory is found without a code change, and a skill without a description is not loaded while an invalid name raises a diagnostic.

## Follow-up

- `scripts/` in a skill directory is not supported, because the agent has no shell. A skill that needs a capability gets a tool for it.
- The review is still the only procedure that has a skill-level evaluation. A criteria change is still measured by a live run rather than by a corpus.
