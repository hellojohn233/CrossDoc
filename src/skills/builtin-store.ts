/**
 * Reads the built-in skills so a user can look at them.
 *
 * The built-in skills are the procedure and the guard rails. They live in the
 * repository, they are versioned with the code, and the user cannot change
 * them. What the user can do is read them: a skill the user cannot see is a
 * rule the user cannot argue with.
 *
 * This module only reads. Writing a built-in skill is not a thing.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { loadSkills, type Skill } from "./loader.js";

/** One file that sits beside a skill and that the skill points at. */
export interface BuiltinSkillReference {
  /** The path the skill refers to, relative to the skill directory. */
  name: string;
  /** The Markdown in that file. */
  body: string;
}

/** A built-in skill, as the user gets to see it. */
export interface BuiltinSkill {
  name: string;
  description: string;
  /** The Markdown body of `SKILL.md`, without the front-matter. */
  body: string;
  /** The files the skill points at, such as `references/examples.md`. */
  references: BuiltinSkillReference[];
}

async function readSkillBody(skill: Skill): Promise<string> {
  const raw = await readFile(skill.filePath, "utf8").catch(() => "");
  if (!raw) return "";
  const { body } = parseFrontmatter(raw);
  return body.trim();
}

async function readReferences(skill: Skill): Promise<BuiltinSkillReference[]> {
  const referencesDirectory = resolve(skill.baseDir, "references");
  const entries = await readdir(referencesDirectory, { withFileTypes: true }).catch(() => []);
  const references: BuiltinSkillReference[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const body = await readFile(resolve(referencesDirectory, entry.name), "utf8").catch(() => "");
    if (!body) continue;
    references.push({ name: `references/${entry.name}`, body: body.trim() });
  }
  return references;
}

/**
 * Lists the built-in skills with their bodies.
 *
 * A skill that cannot be read is skipped rather than shown empty: a skill
 * with no body would look like a skill with nothing to say.
 */
export async function listBuiltinSkills(root?: string): Promise<BuiltinSkill[]> {
  const { skills } = loadSkills(root ? { root } : {});
  const builtins: BuiltinSkill[] = [];
  for (const skill of skills) {
    const body = await readSkillBody(skill);
    if (!body) continue;
    builtins.push({
      name: skill.name,
      description: skill.description,
      body,
      references: await readReferences(skill),
    });
  }
  return builtins.sort((left, right) => left.name.localeCompare(right.name));
}

/** When a built-in skill was last changed in the working tree. */
export async function builtinSkillUpdatedAt(skill: Skill): Promise<string> {
  const stats = await stat(skill.filePath).catch(() => undefined);
  return stats?.mtime.toISOString() ?? "";
}
