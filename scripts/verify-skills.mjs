/**
 * Skill 机制验收。
 *
 * CrossDoc 的 skill 住在 .agents/skills/，按 Agent Skills 规范组织。这个脚本
 * 锁住三件事：
 *   1. 磁盘上的 skill 符合规范（名字规则、description、篇幅、引用文件）；
 *   2. skill 是被发现的，不是写死在代码里的 —— 加一个目录就能多一个 skill；
 *   3. 渐进披露与确定性注入按 Pi 的语义工作。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseFrontmatter } from "../src/skills/frontmatter.ts";
import {
  formatSkillInvocation,
  formatSkillsForPrompt,
  loadSkills,
  resolveInsideSkill,
  validateName,
  MAX_SKILL_DESCRIPTION_LENGTH,
} from "../src/skills/loader.ts";

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

const skillRoot = resolve(process.cwd(), ".agents/skills");
const loaded = loadSkills();
const skills = loaded.skills;
const byName = new Map(skills.map((skill) => [skill.name, skill]));

// ── 1. 磁盘上的 skill 符合规范 ──────────────────────────────
await check("K1 没有 skill 解析诊断", () => {
  const problems = loaded.diagnostics.map((diagnostic) => `${diagnostic.path ?? ""}: ${diagnostic.message}`);
  assert.deepEqual(problems, [], `skill 诊断不为空:\n${problems.join("\n")}`);
});

await check("K2 每个 skill 的 name 合规，且与目录名一致", () => {
  assert.ok(skills.length >= 5, `只发现 ${skills.length} 个 skill`);
  for (const skill of skills) {
    assert.deepEqual(validateName(skill.name), [], `${skill.name} 不符合规范`);
    const directory = skill.filePath.replace(/\/SKILL\.md$/, "");
    assert.equal(directory.split("/").pop(), skill.name, `${skill.name} 的目录名与 name 不一致`);
    assert.match(skill.name, /^[a-z0-9-]+$/);
    assert.ok(skill.name.length <= 64);
  }
});

await check("K3 description 必填且不超长", () => {
  for (const skill of skills) {
    assert.ok(skill.description.trim().length > 0, `${skill.name} 缺少 description`);
    assert.ok(skill.description.length <= MAX_SKILL_DESCRIPTION_LENGTH, `${skill.name} 的 description 超长`);
  }
});

await check("K4 SKILL.md 保持在 500 行以内", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const skill of skills) {
    const content = await readFile(skill.filePath, "utf8");
    const lines = content.split("\n").length;
    assert.ok(lines < 500, `${skill.name} 有 ${lines} 行，应该拆到 references/ 里`);
  }
});

await check("K5 被引用的 references 文件都存在", async () => {
  const { existsSync } = await import("node:fs");
  for (const skill of skills) {
    const content = await (await import("node:fs/promises")).readFile(skill.filePath, "utf8");
    const references = [...content.matchAll(/`(references\/[^`]+)`/g)].map((match) => match[1]);
    for (const reference of references) {
      const target = resolve(skill.baseDir, reference);
      assert.ok(existsSync(target), `${skill.name} 引用了不存在的 ${reference}`);
    }
  }
});

// ── 2. skill 是被发现的，不是写死的 ─────────────────────────
await check("K6 加一个目录就多一个 skill，不需要改代码", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-"));
  try {
    await mkdir(resolve(root, "made-up-skill"), { recursive: true });
    await writeFile(
      resolve(root, "made-up-skill", "SKILL.md"),
      "---\nname: made-up-skill\ndescription: A skill that was not known when the code was written.\n---\n\n# Made up\n",
      "utf8",
    );
    const discovered = loadSkills({ root });
    assert.deepEqual(discovered.diagnostics, []);
    assert.equal(discovered.skills.length, 1);
    assert.equal(discovered.skills[0].name, "made-up-skill");
    assert.equal(discovered.skills[0].description, "A skill that was not known when the code was written.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await check("K7 代码里没有写死的 skill 名单", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(resolve(process.cwd(), "src/agent.ts"), "utf8");
  assert.doesNotMatch(source, /SKILL_NAMES/, "agent.ts 不该再有一份 skill 名单");
  assert.doesNotMatch(source, /Type\.Literal\(/, "skill 参数不该是写死的字面量联合");
});

await check("K8 缺 description 的 skill 不加载，非法 name 报诊断", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-bad-"));
  try {
    await mkdir(resolve(root, "no-description"), { recursive: true });
    await writeFile(resolve(root, "no-description", "SKILL.md"), "---\nname: no-description\n---\n\n# Body\n", "utf8");
    await mkdir(resolve(root, "Bad_Name"), { recursive: true });
    await writeFile(resolve(root, "Bad_Name", "SKILL.md"), "---\nname: Bad_Name\ndescription: An invalid name.\n---\n\n# Body\n", "utf8");

    const discovered = loadSkills({ root });
    assert.equal(discovered.skills.length, 1, "缺 description 的 skill 不该被加载");
    assert.equal(discovered.skills[0].name, "Bad_Name");
    assert.ok(
      discovered.diagnostics.some((diagnostic) => diagnostic.message === "description is required"),
      "缺 description 应该有诊断",
    );
    assert.ok(
      discovered.diagnostics.some((diagnostic) => /invalid characters/.test(diagnostic.message)),
      "非法 name 应该有诊断",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── 3. 渐进披露与确定性注入 ─────────────────────────────────
await check("K9 索引只含可见 skill，且带 name/description/location", () => {
  const index = formatSkillsForPrompt(skills);
  assert.match(index, /<available_skills>/);
  for (const skill of skills) {
    if (skill.disableModelInvocation) {
      assert.doesNotMatch(index, new RegExp(`<name>${skill.name}</name>`), `${skill.name} 不该出现在索引里`);
      continue;
    }
    assert.match(index, new RegExp(`<name>${skill.name}</name>`));
    assert.ok(index.includes(`<description>${skill.description}</description>`), `${skill.name} 的 description 不在索引里`);
    assert.ok(index.includes(`<location>${skill.filePath}</location>`), `${skill.name} 的 location 不在索引里`);
  }
  assert.match(index, /<location>.*SKILL\.md<\/location>/);
});

await check("K10 审查的两个子 skill 只由父 skill 按序加载", () => {
  for (const name of ["key-data-alignment", "conflict-adjudication"]) {
    const skill = byName.get(name);
    assert.ok(skill, `${name} 不存在`);
    assert.equal(skill.disableModelInvocation, true, `${name} 应该 disable-model-invocation`);
  }
  assert.equal(byName.get("consistency-review")?.disableModelInvocation, false, "父 skill 应该可见");
  const parent = byName.get("consistency-review");
  assert.ok(parent, "consistency-review 不存在");
});

await check("K11 确定性注入把 skill 正文放进对话", () => {
  const skill = byName.get("consistency-review");
  const invocation = formatSkillInvocation(skill, "# body\n\nstep one");
  assert.match(invocation, /<skill name="consistency-review" location=".*SKILL\.md">/);
  assert.match(invocation, /References are relative to /);
  assert.match(invocation, /step one/);
  assert.doesNotMatch(invocation, /^---$/m, "注入的正文不该带 front-matter");
});

await check("K12 front-matter 解析读得出键值，正文干净", () => {
  const parsed = parseFrontmatter("---\nname: a-name\ndescription: \"A quoted description.\"\ndisable-model-invocation: true\n---\n\n# Title\n\nText.\n");
  assert.equal(parsed.frontmatter.name, "a-name");
  assert.equal(parsed.frontmatter.description, "A quoted description.");
  assert.equal(parsed.frontmatter["disable-model-invocation"], "true");
  assert.equal(parsed.body, "# Title\n\nText.");
  assert.deepEqual(parsed.warnings, []);
});

await check("K13 read_skill_file 不能读到 skill 目录之外", () => {
  const skill = byName.get("consistency-review");
  assert.equal(resolveInsideSkill(skill, "references/../../../../etc/passwd"), undefined);
  assert.equal(resolveInsideSkill(skill, ".."), undefined);
  assert.ok(resolveInsideSkill(skill, "SKILL.md").endsWith("SKILL.md"));
});

await check("K14 两个 root 一起扫，只给 root 时不碰使用者目录", async () => {
  const builtin = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-builtin-"));
  const user = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-user-"));
  try {
    await mkdir(resolve(builtin, "built-in-skill"), { recursive: true });
    await writeFile(
      resolve(builtin, "built-in-skill", "SKILL.md"),
      "---\nname: built-in-skill\ndescription: A built-in skill.\n---\n\n# Built in\n",
      "utf8",
    );
    await mkdir(resolve(user, "user-skill"), { recursive: true });
    await writeFile(
      resolve(user, "user-skill", "SKILL.md"),
      "---\nname: user-skill\ndescription: A user skill.\n---\n\n# User\n",
      "utf8",
    );
    const both = loadSkills({ root: builtin, userRoot: user });
    const names = both.skills.map((skill) => skill.name).sort();
    assert.deepEqual(names, ["built-in-skill", "user-skill"], "两个目录的 skill 都该被发现");

    const onlyBuiltin = loadSkills({ root: builtin });
    assert.deepEqual(onlyBuiltin.skills.map((skill) => skill.name), ["built-in-skill"], "不给 userRoot 就不该扫使用者目录");
  } finally {
    await rm(builtin, { recursive: true, force: true });
    await rm(user, { recursive: true, force: true });
  }
});

await check("K15 内置 skill 优先于同名使用者 skill", async () => {
  const builtin = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-builtin-"));
  const user = await mkdtemp(resolve(tmpdir(), "crossdoc-skills-user-"));
  try {
    for (const [root, label] of [[builtin, "built-in"], [user, "user"]]) {
      await mkdir(resolve(root, "shared-name"), { recursive: true });
      await writeFile(
        resolve(root, "shared-name", "SKILL.md"),
        `---\nname: shared-name\ndescription: The ${label} one.\n---\n\n# ${label}\n`,
        "utf8",
      );
    }
    const loaded = loadSkills({ root: builtin, userRoot: user });
    const shared = loaded.skills.find((skill) => skill.name === "shared-name");
    assert.ok(shared, "同名 skill 应该还在");
    assert.equal(shared.description, "The built-in one.", "内置 skill 应该赢");
    assert.ok(
      loaded.diagnostics.some((diagnostic) => /conflicts with a built-in skill/.test(diagnostic.message)),
      "同名冲突应该有诊断",
    );
  } finally {
    await rm(builtin, { recursive: true, force: true });
    await rm(user, { recursive: true, force: true });
  }
});

let failed = 0;
for (const result of checks) {
  if (result.ok) {
    console.log(`  ok  ${result.name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${result.name}\n       ${result.message}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exit(1);
