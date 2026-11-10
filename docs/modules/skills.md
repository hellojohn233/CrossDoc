# Skills

Status: Implementation contract

## Purpose

A skill is a procedure the agent reads. The steps, the criteria, and the way a value is written down live in a Markdown file, so changing what a review considers a conflict is a change to a file rather than a release.

The format is the [Agent Skills specification](https://agentskills.io/specification), which is what Pi implements. CrossDoc keeps the files in the standard place, so the same skill directories work under the Pi CLI without a conversion step.

```text
.agents/skills/<skill-name>/SKILL.md    built-in, read-only, versioned in the repository
data/skills/<skill-name>/SKILL.md       the user's own skills, local only
```

## What Pi provides and what it does not

Pi's skill loader lives in its coding-agent application layer (`packages/coding-agent/src/core/skills.ts`), not in the published `@earendil-works/pi-agent-core`. The embedded runtime has no automatic discovery, so CrossDoc implements the loader itself in `src/skills/`.

What CrossDoc borrows from Pi, and where it now lives:

| Pi's behaviour | CrossDoc |
|---|---|
| Discovery: a directory holding `SKILL.md` is a skill root and is not searched further | `src/skills/loader.ts` |
| `description` is required; a skill without one is not loaded | `src/skills/loader.ts` |
| Name rules: lowercase, digits, hyphens, at most 64 characters, no leading, trailing, or consecutive hyphens | `src/skills/loader.ts` |
| Name collisions keep the first skill found and raise a diagnostic | `src/skills/loader.ts` |
| Progressive disclosure: only name, description, and location go into the system prompt | `formatSkillsForPrompt()` |
| `disable-model-invocation` hides a skill from automatic selection | `src/skills/loader.ts` |
| `/skill:name` injects a skill body into the conversation without asking the model | `formatSkillInvocation()` |
| A skill directory may bundle `references/`, `scripts/`, and `assets/` | `references/` is supported; `scripts/` is not, because the agent has no shell |

## The three mechanisms

### Discovery

`loadSkills()` walks `.agents/skills/` and returns the skills it found plus a diagnostic for anything it could not use. The set of skills is never written in code: adding a skill is adding a directory.

`load_document_skill` takes a free string rather than a fixed set of names, so a skill that did not exist when the code was written can still be loaded.

### Progressive disclosure

The system prompt ends with the index:

```xml
<available_skills>
  <skill>
    <name>consistency-review</name>
    <description>Check whether the key data in a set of documents lines up…</description>
    <location>/abs/.agents/skills/consistency-review/SKILL.md</location>
  </skill>
</available_skills>
```

Only the metadata goes in. The bodies are loaded when the task calls for them, so a project with many skills pays for their metadata and not for their instructions.

### Deterministic invocation

`formatSkillInvocation()` produces the block an explicit invocation delivers:

```xml
<skill name="consistency-review" location="/abs/…/SKILL.md">
References are relative to /abs/.agents/skills/consistency-review.

…the body…
</skill>
```

The consistency review uses this path. `runConsistencyReview()` injects the `consistency-review` body into the first turn, so a review can never run without its procedure — the model is not asked to remember to load it.

The steps inside that procedure are still loaded by the agent, in order, through `load_document_skill`. The parent skill names them; they carry `disable-model-invocation: true`, so they are not in the index and the model cannot jump to one of them instead of following the procedure.

## The user's own skills

The built-in skills carry the review procedure, the extraction rules, and the guard rails. What they cannot know is what the documents of one domain look like, and what a difference in that domain means. The user writes that part.

A user skill is **domain knowledge, not procedure**. It answers two questions:

- Which key data does this domain state?
- What does a difference in this domain mean — how severe is it?

It never changes the review procedure. The `consistency-review` skill says so explicitly, and it is loaded after the domain skill, so the procedure always has the last word.

**The repository ships no domain skills.** The built-in set is the procedure skill, the annotation skill, the adjudication skill, and the two reading skills. Domain knowledge is the user's to bring; pre-setting it would make the product's opinion of a domain look like the user's. `scripts/verify-user-skills.mjs` locks that rule.

### Discovery and ownership

`loadSkills()` walks two roots. The built-in one comes first; the user's is read after it:

- A user skill whose name matches a built-in skill is **skipped**, with a diagnostic. The built-in skills are the procedure and the guard rails, and they are versioned in the repository while a user skill is not. The reserved names are computed from what is actually loaded, so a new built-in skill reserves its own name without a second list somewhere.
- A user skill that fails to load is reported as a diagnostic and skipped. The review still runs, on the built-in vocabulary.

The user's skills live under `data/skills/`, which is ignored by Git like the rest of the local data. They are written by the application, not by hand on disk, so the front-matter is generated: the name has to match the directory name, and `disable-model-invocation` is never written — a skill carrying that flag would be invisible to the model that is supposed to load it.

The My Skills page lists them flat. One skill is one file. There is no categorization, no tagging, no inheritance, and no template library: the point is that the user brings one file, not that the application manages a collection.

### Reading a skill

The page has two blocks. The user's own skills come first; the built-in ones follow, and they can only be read. A built-in skill is the procedure and the guard rails, and a rule the user cannot see is a rule the user cannot argue with, so `GET /api/skills/builtin` returns their bodies along with the files they point at.

A skill opens as a document: the Markdown, rendered by `public/js/markdown.js`. The renderer escapes the text before it marks it up, and it keeps a link only when the target is an ordinary web address, because a skill is text that someone can type.

Editing is a second step on purpose. A skill is read far more often than it is written, and an editor is not the place to read one. `编辑` turns the rendered skill into its source, and only `保存` writes it. A built-in skill has no `编辑` action, so it cannot be turned into the source at all.

### The vocabulary does not need to become data

A domain skill lists its keys in its own body, and the agent uses them. Nothing in the alignment code has to change for that to work:

- `alignKeyData()` groups by the key string. It never checks the key against the built-in vocabulary.
- `isTaxonomyKey()` is a display flag, not a gate.
- `keyLabel()` falls back to the key itself for a key the built-in vocabulary does not know.
- `align_key_data` takes an optional `label`, so a domain skill can give its keys a readable name.

The built-in vocabulary of 24 contract keys stays as the default for a review with no domain skill. When a domain skill is loaded, the agent collects against that skill's keys instead of asking `list_key_vocabulary` — the choice of vocabulary is a rule in the wording of `key-data-alignment` and of the tool, not a branch in the code. The agent may still recognise a key it has seen in the built-in reference examples, so a domain skill only has to add the keys it cares about rather than enumerate every key the documents state.

Measured on the example corpus with a real model: with a domain skill in `data/skills/`, the run stopped calling `list_key_vocabulary` and extracted the domain's own keys alongside a few contract-shaped ones. Without one, it called `list_key_vocabulary` and extracted exactly the built-in vocabulary.

### A minimal example

```markdown
---
name: prospectus-review
description: 用于审查证券招股说明书。当这批文档是招股书、募集说明书或发行公告时加载它。
---

# 招股说明书审查

本领域该抽的关键数据：

- `revenue` —— 营业收入
- `gross_margin` —— 毛利率
- `audit_opinion` —— 审计意见

本领域什么差异算严重：

- `audit_opinion` 变了 = high（审计意见被修改）
- `revenue` 金额变了 = high
```

The description is what the model routes on, so it has to say which documents the skill is for. A vague description loads the wrong skill.

## Bundled reference files

A skill directory may hold files besides `SKILL.md`. CrossDoc supports `references/`: the agent reads one with `read_skill_file`, naming the skill and a path relative to the skill directory.

```markdown
For worked examples, read `references/examples.md`.
```

The path is resolved inside the skill's own directory. A path that escapes it is refused.

`scripts/` is not supported. Pi's skills may bundle executable code, but the CrossDoc agent has no shell and no filesystem tool on purpose: every file it touches is in the request's document scope. A skill that needs a capability gets a tool for it, not a script.

## Contract

```ts
Skill = {
  name: string;          // lowercase a-z, 0-9, hyphens; at most 64 characters
  description: string;   // required, at most 1024 characters
  filePath: string;      // absolute path of SKILL.md
  baseDir: string;       // absolute path of the skill directory
  disableModelInvocation: boolean;
};

SkillDiagnostic = {
  type: "warning" | "collision";
  message: string;
  path?: string;
  collision?: { name: string; winnerPath: string; loserPath: string };
};
```

## Verification

`scripts/verify-skills.mjs` checks the skills on disk against the specification: the name rules, the directory name matching the declared name, the description, the length of `SKILL.md`, the existence of every referenced file, that the index holds exactly the visible skills, that the review's two child skills are hidden, and that the agent source no longer contains a hardcoded list.

It also checks that discovery works: a skill directory written into a temporary root is found and read without any code change. Two more checks cover the two roots: both are scanned when both are given, and a built-in skill wins over a user skill with the same name.

`scripts/verify-user-skills.mjs` covers the user's side: that a user skill is discovered and indexed, that a built-in skill cannot be replaced, that the four invalid writes are refused, that a saved skill is found right away and a deleted one is gone, that a custom key aligns without the vocabulary becoming data, that an imported `SKILL.md` is parsed, that the four endpoints behave, that a domain skill reaches the conversation of a real review run, and that the repository ships no domain skill at all.

A skill without a description is not loaded. That is the specification's rule and it is also the one that matters here: the description is what the model routes on.
