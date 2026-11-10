---
id: ui-006
scope: skill-reading
depends_on: [skill-002, ui-005]
status: done
---

# ui-006: Let the skills be read

## Objective

Show the built-in skills in the user's skill page, and make a skill read like the Markdown it was written in before it can be edited.

## Context

Two things were missing from the skill page.

The built-in skills were invisible. The page said they were "not here, they ship with the code", which is true and useless: the built-in skills hold the review procedure and the guard rails, and a rule the user cannot read is a rule the user cannot argue with. The user asked for them to be listed, in their own block, read-only.

And the user's own skill was edited, not read. One row led straight to a form with a text area, which is the wrong way to look at a document. The user asked for it to work the other way round: open it as a document, then edit it.

## Decision

### Two blocks, not one list

The user's own skills come first and carry the `查看` / `编辑` / `删除` actions. The built-in skills follow in their own block, marked `内置 · 随代码发布`, and a built-in row offers `查看` only. The detail page says `内置 skill · 只能查看` where the edit action would otherwise be, so the reason is visible rather than missing.

`GET /api/skills/builtin` returns the built-in skills with their bodies and the files they point at, such as `references/examples.md`. `src/skills/builtin-store.ts` only reads; there is no path that writes a built-in skill.

### A skill opens as a document

The body is rendered Markdown. `public/js/markdown.js` is a small renderer for what a skill actually uses: headings, paragraphs, lists, quotes, code, rules, and the inline marks. It escapes the text before it marks it up and keeps a link only when the target is an ordinary web address, because a skill is text that someone can type.

`编辑` turns the rendered skill into its source, and only `保存` writes it. `取消` goes back to the rendered skill. A built-in skill has no `编辑` button, so it cannot be turned into the source at all.

## Scope

- `src/skills/builtin-store.ts`: read a built-in skill and the files it points at.
- `src/server.ts`: `GET /api/skills/builtin`.
- `public/js/markdown.js`: the Markdown renderer.
- `public/index.html` and `public/styles.css`: the two blocks and the detail page.
- `scripts/verify-markdown.mjs`: thirteen checks over the renderer.
- `scripts/verify-user-skills.mjs`: one more check over the built-in endpoint.

## Outcome

- The built-in skills are listed under the user's own ones, and they can be read but not written.
- A skill opens as rendered Markdown; editing is a second step, and saving is a third.
- The renderer does not let the text in a skill become markup.

## Follow-up

- **The renderer is small.** It covers what the built-in skills use. A table or a nested list deeper than one level is not rendered as the author wrote it.
- **A built-in skill is not editable, not even by the developer.** Changing one means changing the file in the repository, which is the point.
