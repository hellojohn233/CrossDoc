import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import { MAX_SKILL_DESCRIPTION_LENGTH, validateName } from "./loader.js";

/**
 * The skills the user owns.
 *
 * The built-in skills live in the repository and are read-only: they carry the
 * review procedure, the extraction rules, and the guard rails. A user skill
 * lives under `data/skills/` and carries something the built-in skills cannot
 * know: what the documents of one domain look like, and what a difference in
 * that domain means.
 *
 * A user skill never changes the procedure. It is loaded by the procedure when
 * the documents turn out to belong to its domain.
 */

const SKILL_FILE = "SKILL.md";
const TEMP_FILE = ".SKILL.md.tmp";

/** One skill the user owns. */
export interface UserSkill {
  /** Directory name, and the skill's name. */
  name: string;
  /** What the skill is for, and when it applies. */
  description: string;
  /** The body of the skill, without the front-matter. */
  body: string;
  /** When the skill was last written. */
  updatedAt: string;
}

/** Where user skills live when no data directory is given. */
export function defaultUserSkillsRoot(): string {
  return resolve(process.cwd(), "data/skills");
}

/** The directory one user skill lives in. */
export function userSkillDirectory(root: string, name: string): string {
  return resolve(root, name);
}

function skillFilePath(root: string, name: string): string {
  return resolve(root, name, SKILL_FILE);
}

function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function referencedFiles(body: string): string[] {
  return [...body.matchAll(/`(references\/[^`]+)`/g)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === "string");
}

export interface UserSkillValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  skill?: UserSkill;
}

/**
 * Checks one user skill before it is written.
 *
 * The name rules come from the Agent Skills specification. The reserved names
 * are the built-in skills: the procedure and the guard rails are not the
 * user's to replace, and the built-in skills are versioned in the repository
 * while a user skill is not.
 */
export function validateUserSkill(
  input: { name: string; description: string; body: string },
  reservedNames: ReadonlySet<string> = new Set(),
  options: { root?: string } = {},
): UserSkillValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = input.name.trim();
  const description = normalizeDescription(input.description);
  const body = input.body.trim();

  errors.push(...validateName(name).map((error) => `名字不合法：${error}`));
  if (reservedNames.has(name)) {
    errors.push(`“${name}” 是内置 skill 的名字，不能覆盖。`);
  }
  if (!description) {
    errors.push("描述不能为空：agent 靠它判断什么时候该加载这份 skill。");
  } else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    errors.push(`描述超过 ${MAX_SKILL_DESCRIPTION_LENGTH} 个字符。`);
  }
  if (!body) {
    errors.push("正文不能为空。");
  }

  if (options.root) {
    for (const reference of referencedFiles(body)) {
      if (!existsSync(resolve(options.root, name, reference))) {
        warnings.push(`引用的 ${reference} 不在这个 skill 的目录里，agent 读它的时候会失败。`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    skill: { name, description, body, updatedAt: new Date().toISOString() },
  };
}

/**
 * Renders the file a user skill is stored as.
 *
 * The front-matter is written by the application, not by the user: the name
 * has to match the directory name, and `disable-model-invocation` would put
 * the skill out of reach of the model that is supposed to load it.
 */
export function renderUserSkillFile(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

/** Reads one user skill, or undefined when it is not there. */
export async function readUserSkill(root: string, name: string): Promise<UserSkill | undefined> {
  try {
    const raw = await readFile(skillFilePath(root, name), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const stats = await stat(skillFilePath(root, name));
    return {
      name,
      description: frontmatter.description?.trim() ?? "",
      body,
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}

/** Every user skill, newest first. The list is flat: a skill is a file. */
export async function listUserSkills(root: string): Promise<UserSkill[]> {
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  const skills: UserSkill[] = [];
  for (const name of names) {
    const skill = await readUserSkill(root, name);
    if (skill) skills.push(skill);
  }
  return skills.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Writes one user skill.
 *
 * The file is written to a temporary name and renamed into place, so an agent
 * that scans the directory mid-write never reads half a skill.
 */
export async function writeUserSkill(
  root: string,
  name: string,
  input: { description: string; body: string },
): Promise<UserSkill> {
  const description = normalizeDescription(input.description);
  const body = input.body.trim();
  const directory = userSkillDirectory(root, name);
  await mkdir(directory, { recursive: true });
  const temporary = resolve(directory, TEMP_FILE);
  await writeFile(temporary, renderUserSkillFile(name, description, body), "utf8");
  await rename(temporary, skillFilePath(root, name));
  const written = await readUserSkill(root, name);
  return written ?? { name, description, body, updatedAt: new Date().toISOString() };
}

/** Removes one user skill. Returns false when there was nothing to remove. */
export async function deleteUserSkill(root: string, name: string): Promise<boolean> {
  try {
    await stat(skillFilePath(root, name));
  } catch {
    return false;
  }
  await rm(userSkillDirectory(root, name), { recursive: true, force: true });
  return true;
}

export interface ImportedSkill {
  name: string;
  description: string;
  body: string;
}

/**
 * Reads a SKILL.md the user brought along.
 *
 * The file is parsed but not written: an imported skill changes what the next
 * review does, so the user sees it in the editor first and saves it on purpose.
 */
export function importUserSkill(content: string): { ok: true; skill: ImportedSkill } | { ok: false; error: string } {
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name?.trim() ?? "";
  const description = normalizeDescription(frontmatter.description ?? "");
  if (!name) return { ok: false, error: "这份文件没有 front-matter 的 name。" };
  if (!description) return { ok: false, error: "这份文件没有 front-matter 的 description。" };
  if (!body.trim()) return { ok: false, error: "这份文件的正文是空的。" };
  const nameErrors = validateName(name);
  if (nameErrors.length > 0) {
    return { ok: false, error: `名字不合法：${nameErrors.join("；")}` };
  }
  return { ok: true, skill: { name, description, body } };
}
