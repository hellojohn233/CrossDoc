---
id: skill-002
scope: user-domain-skills
depends_on: [review-005, ui-003]
status: done
---

# skill-002: Let the user bring their own domain skill

## Objective

Give the user a way to write a skill for one document domain — a prospectus, a financial report, a technical specification — and have the review pick it up. The built-in skills keep the procedure and the guard rails; the user's skill adds the domain knowledge the product cannot know.

## Context

The review procedure already lives in skills rather than in code. What it could not do was leave the review policy to the user: the key vocabulary was a fixed list of 24 contract terms compiled into `src/core/key-data.ts`, and the severity criteria were written for contracts.

The user asked for the opposite of a domain catalogue. The point is not that the product ships a skill per domain — that would bake the product's opinion of a domain into the product — but that the user can bring one. So the deliverable is a mechanism and a place to put a file, not a library of domains.

Three things had to be true at once:

- **A domain skill is knowledge, not procedure.** It answers "which key data does this domain state" and "what does a difference in this domain mean". It never changes the steps.
- **The retrieval stays general.** Key alignment groups by the key string, retrieval is lexical, and a finding without a citable quote is dropped. None of that forks per domain.
- **A missing domain skill is not a downgrade.** A review with no domain skill runs the general way on the built-in vocabulary.

## Decision

### The user's skills live in their own directory

`data/skills/<name>/SKILL.md`, next to the library and the database, ignored by Git like the rest of the local data. The built-in skills stay in `.agents/skills/` and are versioned in the repository.

`loadSkills()` reads the built-in root first and the user's root after it. A user skill whose name matches a built-in one is **skipped**, with a diagnostic: the built-in skills are the procedure and the guard rails, and the user cannot replace them. The reserved names are computed from what is actually loaded rather than written down anywhere, so a new built-in skill reserves its own name without a second list.

`loadSkills()` scans the user's root only when it is given one. The verification scripts therefore stay independent of whatever the user has on their machine.

### The vocabulary does not have to become data

The plan assumed the built-in vocabulary had to become a data file for a domain skill to work. It does not, and checking the code says so:

- `alignKeyData()` (`src/tools/align.ts:21`) groups by the key string and never checks it against the vocabulary.
- `isTaxonomyKey()` is a display flag, not a gate.
- `keyLabel()` falls back to the key itself for a key the vocabulary does not know.
- `align_key_data` takes an optional `label`, so a domain skill can give its keys a readable name.

So a domain skill lists its keys in its own body, the agent uses them, and the alignment works exactly as it does for built-in keys. No data file, no schema, no loader for it.

Which vocabulary applies is a rule in the wording of `key-data-alignment` and of the `list_key_vocabulary` tool: with a domain skill loaded, the agent does not ask for the built-in list.

### The front-matter is written by the application

The user's skill is three fields — name, description, body — and the server writes the file. Two reasons:

- The name has to match the directory name, and `verify-skills.mjs` asserts it. A hand-written front-matter is easy to get wrong.
- `disable-model-invocation` would put the skill out of reach of the model that is supposed to load it. The server never writes it.

### The entry point is a page, not a tool

`我的技能` is the fourth header tab. It opens a list page: one row per skill with its name, description, and last change, plus `新建` / `导入 .md`. Picking a row opens a second screen with the editor and `保存` / `删除`, and a `← 返回列表` control goes back. There is no categorization, no tagging, no inheritance, no template library, and no `write_skill` tool — the user asked for something small and simple, and the user writes the file themselves.

Importing parses a `SKILL.md` the user already has and fills the editor. It does not save it: an imported skill changes what the next review does, so the user sees it first.

## Scope

- `src/skills/user-store.ts`: read, validate, write, delete, and import the user's skills.
- `src/skills/loader.ts`: a second root, with the built-in skills winning a name collision.
- `src/agent.ts` and `src/review-run.ts`: carry the user's skills root to the agent.
- `src/server.ts`: `GET /api/skills`, `PUT /api/skills/:name`, `DELETE /api/skills/:name`, `POST /api/skills/import`.
- `src/cli.ts`: the command line reads the user's skills too.
- `.agents/skills/consistency-review/SKILL.md` and `.agents/skills/key-data-alignment/SKILL.md`: the wording that makes a domain skill enter.
- `public/index.html` and `public/styles.css`: the skills view.
- `scripts/verify-user-skills.mjs` and two more checks in `scripts/verify-skills.mjs`.

## Outcome

- The repository ships no domain skill. The built-in set is the procedure, the annotation, the adjudication, and the two reading skills.
- A user skill is discovered, indexed, and loaded by the agent. In a real run over the example corpus, the agent loaded the domain skill and extracted its own keys (`payment_days`, `signing_party`); the four conflicts it reported included the payment period and the counterparty, both of which came from the domain skill's keys.
- With no domain skill, the same corpus produced exactly the built-in vocabulary — `contract_subject`, `contract_value`, `currency`, `payment_term`, `effective_date`, `term_length`, `service_scope`, `confidentiality`.
- The skills view lists the user's skills flat, edits them, imports a `SKILL.md`, and refuses a name a built-in skill already uses.

`scripts/verify-user-skills.mjs` passes with eighteen checks and runs offline.

## Follow-up

- **The built-in reference files still name built-in keys.** With a domain skill loaded the agent stops calling `list_key_vocabulary`, but it may still recognise a key it saw in `references/examples.md`. The vocabulary is therefore not strictly replaced, only not requested. Making it strict means the vocabulary has to become data, which is the change this task deliberately avoided.
- **The agent chooses the domain.** It routes on the domain skill's description, so a vague description loads the wrong skill. The view says so where the description is written.
- **No evaluation set.** This task proves the mechanism, not that a given domain skill produces good findings. See `docs/plan/backlog.md`.
