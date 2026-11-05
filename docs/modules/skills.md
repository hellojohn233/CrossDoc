# Skills

Status: Implementation contract

## Purpose

A skill is a procedure the agent reads. The steps, the criteria, and the way a value is written down live in a Markdown file, so changing what a review considers a conflict is a change to a file rather than a release.

The format is the [Agent Skills specification](https://agentskills.io/specification), which is what Pi implements. CrossDoc keeps the files in the standard place, so the same skill directories work under the Pi CLI without a conversion step.

```text
.agents/skills/<skill-name>/SKILL.md
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

It also checks that discovery works: a skill directory written into a temporary root is found and read without any code change.

A skill without a description is not loaded. That is the specification's rule and it is also the one that matters here: the description is what the model routes on.
