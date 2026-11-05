import { existsSync, readdirSync, readFileSync, realpathSync, statSync, type Dirent } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "./frontmatter.js";

/**
 * One skill: a directory with a `SKILL.md` in it.
 *
 * The shape follows the Agent Skills specification that Pi implements, so the
 * same files work under the Pi CLI without a conversion step.
 */
export interface Skill {
  /** Lowercase, hyphen-separated, at most 64 characters. */
  name: string;
  /** What the skill does and when it applies. Never empty. */
  description: string;
  /** Absolute path of the `SKILL.md`. */
  filePath: string;
  /** Absolute path of the skill directory; relative references resolve against it. */
  baseDir: string;
  /** True when the skill is only reachable by an explicit request. */
  disableModelInvocation: boolean;
}

export interface SkillCollision {
  name: string;
  winnerPath: string;
  loserPath: string;
}

export interface SkillDiagnostic {
  type: "warning" | "collision";
  message: string;
  path?: string;
  collision?: SkillCollision;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}

/** Per the Agent Skills specification. */
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

const SKILL_FILE = "SKILL.md";
const IGNORED_DIRECTORIES = new Set(["node_modules"]);

/**
 * Where the project's skills live.
 *
 * The module-relative path is used first because it is the same in a source
 * checkout and in a build; the working directory is the fallback for a server
 * started from somewhere else.
 */
export function defaultSkillsRoot(): string {
  const moduleRelative = resolve(dirname(fileURLToPath(import.meta.url)), "../../.agents/skills");
  if (existsSync(moduleRelative)) return moduleRelative;
  return resolve(process.cwd(), ".agents/skills");
}

export interface LoadSkillsOptions {
  /** Directory to scan. Defaults to the project's `.agents/skills`. */
  root?: string;
}

/**
 * Discovers the skills under a directory and validates them.
 *
 * Discovery follows Pi's rules: a directory that contains a `SKILL.md` is a
 * skill root and is not searched further, and every other directory is
 * searched for one. A skill without a description is not loaded at all,
 * because the description is what the model routes on.
 */
export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult {
  const root = resolve(options.root ?? defaultSkillsRoot());
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const byName = new Map<string, Skill>();
  const seenPaths = new Set<string>();

  if (!existsSync(root)) {
    diagnostics.push({ type: "warning", message: "skills directory does not exist", path: root });
    return { skills, diagnostics };
  }

  const found: Skill[] = [];
  collect(root, found, diagnostics);

  for (const skill of found) {
    const key = realPath(skill.filePath);
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    const existing = byName.get(skill.name);
    if (existing) {
      diagnostics.push({
        type: "collision",
        message: `name "${skill.name}" collision`,
        path: skill.filePath,
        collision: { name: skill.name, winnerPath: existing.filePath, loserPath: skill.filePath },
      });
      continue;
    }
    byName.set(skill.name, skill);
    skills.push(skill);
  }

  return { skills, diagnostics };
}

function collect(directory: string, found: Skill[], diagnostics: SkillDiagnostic[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  const skillFile = join(directory, SKILL_FILE);
  if (existsSync(skillFile) && statSync(skillFile).isFile()) {
    const skill = loadSkillFile(skillFile, diagnostics);
    if (skill) found.push(skill);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      collect(path, found, diagnostics);
      continue;
    }
    if (stats.isFile() && entry.name.endsWith(".md")) {
      const skill = loadSkillFile(path, diagnostics);
      if (skill) found.push(skill);
    }
  }
}

/** Reads one skill file and validates its front-matter. */
export function loadSkillFile(filePath: string, diagnostics: SkillDiagnostic[] = []): Skill | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push({ type: "warning", message: error instanceof Error ? error.message : "failed to read skill file", path: filePath });
    return undefined;
  }

  const { frontmatter, body, warnings } = parseFrontmatter(raw);
  for (const warning of warnings) {
    diagnostics.push({ type: "warning", message: warning, path: filePath });
  }

  const description = frontmatter.description?.trim() ?? "";
  if (!description) {
    diagnostics.push({ type: "warning", message: "description is required", path: filePath });
    return undefined;
  }
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    diagnostics.push({ type: "warning", message: `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`, path: filePath });
  }

  const baseDir = dirname(filePath);
  const name = frontmatter.name?.trim() || baseDir.split("/").pop() || baseDir;
  for (const error of validateName(name)) {
    diagnostics.push({ type: "warning", message: error, path: filePath });
  }

  return {
    name,
    description,
    filePath,
    baseDir,
    disableModelInvocation: frontmatter["disable-model-invocation"]?.trim().toLowerCase() === "true",
  };
}

/** The name rules from the Agent Skills specification. */
export function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > MAX_SKILL_NAME_LENGTH) errors.push(`name exceeds ${MAX_SKILL_NAME_LENGTH} characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  if (name.startsWith("-") || name.endsWith("-")) errors.push("name must not start or end with a hyphen");
  if (name.includes("--")) errors.push("name must not contain consecutive hyphens");
  return errors;
}

/**
 * Formats the skills as the index the model routes on.
 *
 * Only the name, the description and the location go into the system prompt.
 * The bodies are loaded on demand, so a project with many skills pays for
 * their metadata and not for their instructions.
 */
export function formatSkillsForPrompt(skills: Skill[], toolName = "load_document_skill"): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) return "";

  return [
    "",
    "The following skills provide specialized instructions for specific tasks.",
    `Use the ${toolName} tool to load a skill's file when the task matches its description.`,
    "Resolve relative paths against the skill's directory (parent of SKILL.md).",
    "",
    "<available_skills>",
    ...visible.flatMap((skill) => [
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.filePath)}</location>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}

/**
 * Formats a skill body the way an explicit invocation delivers it.
 *
 * This is the deterministic path: the instructions are already in the
 * conversation, so nothing depends on the model deciding to ask for them.
 */
export function formatSkillInvocation(skill: Skill, body: string): string {
  return [
    `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`,
    `References are relative to ${skill.baseDir}.`,
    "",
    body.trim(),
    "",
    "</skill>",
  ].join("\n");
}

/** Reads a skill body, without its front-matter. */
export function readSkillBody(skill: Skill): string {
  return parseFrontmatter(readFileSync(skill.filePath, "utf8")).body;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function realPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

/** The absolute path of a file inside a skill directory, or undefined when it is outside. */
export function resolveInsideSkill(skill: Skill, relativePath: string): string | undefined {
  const target = resolve(skill.baseDir, relativePath);
  const inside = relative(skill.baseDir, target);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`)) return undefined;
  return target;
}
