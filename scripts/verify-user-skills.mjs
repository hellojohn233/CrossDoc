/**
 * 用户领域 skill 的验收。
 *
 * 领域 skill 是使用者自己的：一份文件、一段正文、只讲这个领域抽什么和什么
 * 差异算严重。这个脚本锁住五件事：
 *   1. 使用者目录里的 skill 会被发现，并且能被 agent 渐进式加载；
 *   2. 内置 skill 不会被覆盖；
 *   3. 写入前有校验，校验不过就不落盘；
 *   4. 自定义 key 全链路可用 —— 词表不需要变成数据文件；
 *   5. 仓库里不预置任何领域 skill。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseFrontmatter } from "../src/skills/frontmatter.ts";
import { formatSkillsForPrompt, loadSkills, validateName } from "../src/skills/loader.ts";
import {
  deleteUserSkill,
  importUserSkill,
  listUserSkills,
  readUserSkill,
  renderUserSkillFile,
  validateUserSkill,
  writeUserSkill,
} from "../src/skills/user-store.ts";
import { alignKeyData, expandAlignedPairs } from "../src/tools/align.ts";
import { createWebApp, listenWebApp } from "../src/server.ts";
import { runConsistencyReview } from "../src/review-run.ts";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, message: error.message });
  }
};

const builtinRoot = resolve(process.cwd(), ".agents/skills");
const userRoot = await mkdtemp(resolve(tmpdir(), "crossdoc-user-skills-"));

async function writeUserSkillFile(root, name, description, body) {
  await mkdir(resolve(root, name), { recursive: true });
  await writeFile(resolve(root, name, "SKILL.md"), renderUserSkillFile(name, description, body), "utf8");
}

// ── 1. 发现与渐进式披露 ─────────────────────────────────
await check("U1 使用者目录里的 skill 被发现，描述与正文正确读出", async () => {
  await writeUserSkillFile(userRoot, "prospectus-review", "用于审查证券招股说明书。", "# 招股书\n\n抽 revenue 和 net_income。\n");
  const loaded = loadSkills({ root: builtinRoot, userRoot });
  const skill = loaded.skills.find((item) => item.name === "prospectus-review");
  assert.ok(skill, "使用者 skill 没有被发现");
  assert.equal(skill.description, "用于审查证券招股说明书。");
  const { body } = parseFrontmatter(await readFile(skill.filePath, "utf8"));
  assert.match(body, /revenue/);
});

await check("U2 使用者 skill 与内置同名时内置赢，那份被跳过并有诊断", async () => {
  const shadowRoot = await mkdtemp(resolve(tmpdir(), "crossdoc-user-skills-shadow-"));
  try {
    await writeUserSkillFile(shadowRoot, "consistency-review", "冒充流程 skill。", "# 冒充\n");
    const loaded = loadSkills({ root: builtinRoot, userRoot: shadowRoot });
    const built = loaded.skills.find((item) => item.name === "consistency-review");
    assert.ok(built, "内置 skill 应该在");
    assert.ok(!built.filePath.includes("crossdoc-user-skills-shadow"), "内置 skill 被覆盖了");
    assert.ok(
      loaded.diagnostics.some((diagnostic) => /conflicts with a built-in skill/.test(diagnostic.message)),
      "同名冲突应该有诊断",
    );
  } finally {
    await rm(shadowRoot, { recursive: true, force: true });
  }
});

await check("U3 使用者 skill 出现在 available_skills 索引里", () => {
  const loaded = loadSkills({ root: builtinRoot, userRoot });
  const index = formatSkillsForPrompt(loaded.skills);
  assert.match(index, /<available_skills>/);
  assert.match(index, /<name>prospectus-review<\/name>/);
  assert.match(index, /用于审查证券招股说明书。/);
});

await check("U4 使用者 skill 的 front-matter 不带 disable-model-invocation", () => {
  const loaded = loadSkills({ root: builtinRoot, userRoot });
  const skill = loaded.skills.find((item) => item.name === "prospectus-review");
  assert.ok(skill);
  assert.equal(skill.disableModelInvocation, false, "带了这个标记的 skill 路由不到");
  const index = formatSkillsForPrompt(loaded.skills);
  assert.ok(index.includes("<name>prospectus-review</name>"), "使用者 skill 必须出现在索引里");
});

// ── 2. 校验 ────────────────────────────────────────────
await check("U5 四种非法输入都被拒绝", () => {
  const reserved = new Set(["consistency-review"]);
  const badName = validateUserSkill({ name: "Bad_Name", description: "描述。", body: "正文。" }, reserved);
  assert.equal(badName.ok, false);
  assert.ok(badName.errors.some((error) => /名字不合法/.test(error)));

  const noDescription = validateUserSkill({ name: "fine", description: "   ", body: "正文。" }, reserved);
  assert.equal(noDescription.ok, false);
  assert.ok(noDescription.errors.some((error) => /描述不能为空/.test(error)));

  const noBody = validateUserSkill({ name: "fine", description: "描述。", body: "  " }, reserved);
  assert.equal(noBody.ok, false);
  assert.ok(noBody.errors.some((error) => /正文不能为空/.test(error)));

  const reservedName = validateUserSkill({ name: "consistency-review", description: "描述。", body: "正文。" }, reserved);
  assert.equal(reservedName.ok, false);
  assert.ok(reservedName.errors.some((error) => /内置 skill/.test(error)));

  const good = validateUserSkill({ name: "fine", description: "描述。", body: "正文。" }, reserved);
  assert.equal(good.ok, true);
});

await check("U6 校验不过就不落盘", async () => {
  const guarded = await mkdtemp(resolve(tmpdir(), "crossdoc-user-skills-guarded-"));
  try {
    const result = validateUserSkill({ name: "Bad_Name", description: "描述。", body: "正文。" });
    assert.equal(result.ok, false);
    // 校验失败的 skill 不会走到写入这一步，目录里也就不该出现它。
    const listed = await listUserSkills(guarded);
    assert.deepEqual(listed, []);
    await assert.rejects(() => stat(resolve(guarded, "Bad_Name")));
  } finally {
    await rm(guarded, { recursive: true, force: true });
  }
});

// ── 3. 写入与删除 ───────────────────────────────────────
await check("U7 保存后立刻能被发现，删除后消失且目录被移除", async () => {
  const store = await mkdtemp(resolve(tmpdir(), "crossdoc-user-skills-store-"));
  try {
    await writeUserSkill(store, "financial-review", { description: "用于审查财报。", body: "抽 revenue。" });
    const afterWrite = loadSkills({ root: builtinRoot, userRoot: store });
    assert.ok(afterWrite.skills.some((item) => item.name === "financial-review"), "保存后没有被发现");

    const listed = await listUserSkills(store);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].description, "用于审查财报。");
    assert.equal(listed[0].body, "抽 revenue。");

    const read = await readUserSkill(store, "financial-review");
    assert.equal(read?.name, "financial-review");
    assert.ok(read?.updatedAt);

    assert.equal(await deleteUserSkill(store, "financial-review"), true);
    assert.equal(await deleteUserSkill(store, "financial-review"), false);
    const afterDelete = loadSkills({ root: builtinRoot, userRoot: store });
    assert.ok(!afterDelete.skills.some((item) => item.name === "financial-review"), "删除后还在");
    await assert.rejects(() => stat(resolve(store, "financial-review")));
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

// ── 4. 自定义 key 全链路可用 ─────────────────────────────
await check("U8 自定义 key 能对齐，词表不需要变成数据文件", () => {
  const items = [
    { id: "a:revenue:1", documentId: "a", key: "revenue", label: "营业收入", value: "USD 1200", quote: "收入为 USD 1200", confidence: 0.8, custom: true },
    { id: "b:revenue:1", documentId: "b", key: "revenue", label: "营业收入", value: "USD 1500", quote: "收入为 USD 1500", confidence: 0.8, custom: true },
    { id: "a:net_income:1", documentId: "a", key: "net_income", label: "净利润", value: "USD 300", quote: "净利润 USD 300", confidence: 0.8, custom: true },
    { id: "b:net_income:1", documentId: "b", key: "net_income", label: "净利润", value: "USD 300", quote: "净利润 USD 300", confidence: 0.8, custom: true },
  ];
  const groups = alignKeyData(items);
  const byKey = new Map(groups.map((group) => [group.key, group]));
  assert.ok(byKey.has("revenue"), "自定义 key 没有成组");
  assert.ok(byKey.has("net_income"), "自定义 key 没有成组");
  assert.equal(byKey.get("revenue").consistent, false);
  assert.equal(byKey.get("net_income").consistent, true);
  const pairs = expandAlignedPairs(groups);
  assert.equal(pairs.length, 1, "只有取值不同的 key 该产生待判定对");
  assert.equal(pairs[0].key, "revenue");
  assert.equal(pairs[0].label, "营业收入", "领域 skill 带来的 label 要保留");
});

// ── 5. 导入 ────────────────────────────────────────────
await check("U9 导入一份 SKILL.md 能解析出名字、描述和正文", () => {
  const imported = importUserSkill([
    "---",
    "name: policy-review",
    "description: 用于审查内部政策文件。",
    "---",
    "",
    "# 政策",
    "",
    "抽 approval_role。",
  ].join("\n"));
  assert.equal(imported.ok, true);
  assert.equal(imported.skill.name, "policy-review");
  assert.equal(imported.skill.description, "用于审查内部政策文件。");
  assert.match(imported.skill.body, /approval_role/);
});

await check("U10 导入坏掉的 skill 会报错而不是写盘", () => {
  const noName = importUserSkill("# 没有 front-matter\n\n正文。");
  assert.equal(noName.ok, false);
  const noDescription = importUserSkill("---\nname: x\n---\n\n正文。");
  assert.equal(noDescription.ok, false);
  const emptyBody = importUserSkill("---\nname: x\ndescription: 描述。\n---\n\n   ");
  assert.equal(emptyBody.ok, false);
  const badName = importUserSkill("---\nname: Bad_Name\ndescription: 描述。\n---\n\n正文。");
  assert.equal(badName.ok, false);
});

// ── 6. 仓库里不预置领域 skill ─────────────────────────────
await check("U11 仓库里没有预置任何领域 skill", async () => {
  const builtIn = loadSkills({ root: builtinRoot }).skills.map((skill) => skill.name);
  const allowed = new Set([
    "consistency-review",
    "key-data-alignment",
    "conflict-adjudication",
    "document-overview",
    "pdf-reading",
  ]);
  for (const name of builtIn) {
    assert.ok(allowed.has(name), `仓库里多了一个内置 skill：${name}`);
  }
  // 内置 skill 的正文里也不能塞进某个领域的知识。
  const review = await readFile(resolve(builtinRoot, "consistency-review", "SKILL.md"), "utf8");
  assert.ok(!/招股|财报|prospectus|financial/i.test(review), "流程 skill 里不该写某个领域的知识");
});

await check("U12 内置 skill 的名字规则仍然成立", () => {
  for (const name of loadSkills({ root: builtinRoot }).skills.map((skill) => skill.name)) {
    assert.deepEqual(validateName(name), [], `${name} 不符合规范`);
  }
});

// ── 7. 应用里的接口 ─────────────────────────────────────
const serverRoot = await mkdtemp(resolve(tmpdir(), "crossdoc-user-skills-server-"));
const app = createWebApp({
  publicDirectory: "public",
  libraryDirectory: resolve(serverRoot, "library"),
  dataDirectory: serverRoot,
  reviewDirectory: resolve(serverRoot, "reviews"),
  uploadDirectory: resolve(serverRoot, "uploads"),
});
const server = listenWebApp(app, 0);
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

await check("U19 GET /api/skills/builtin 列出内置 skill，带正文，且不能改", async () => {
  const response = await fetch(`${base}/api/skills/builtin`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.skills.length >= 3, "内置 skill 至少要有几个");
  const review = data.skills.find((skill) => skill.name === "consistency-review");
  assert.ok(review, "consistency-review 应该在列表里");
  assert.match(review.body, /Consistency review/);
  assert.ok(review.description.length > 0);
  // 内置 skill 的正文可以被读，但改不了。
  const refused = await fetch(`${base}/api/skills/consistency-review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "改一下", body: "改一下" }),
  });
  assert.equal(refused.status, 409);
  const unchanged = await (await fetch(`${base}/api/skills/builtin`)).json();
  const same = unchanged.skills.find((skill) => skill.name === "consistency-review");
  assert.equal(same.body, review.body);
});

await check("U13 GET /api/skills 列出使用者自己的 skill", async () => {
  const before = await (await fetch(`${base}/api/skills`)).json();
  assert.deepEqual(before.skills, [], "刚开始应该一份都没有");

  const saved = await fetch(`${base}/api/skills/prospectus-review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "用于审查证券招股说明书。", body: "本领域抽 revenue / net_income。" }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.skill.name, "prospectus-review");
  assert.equal(savedBody.skill.description, "用于审查证券招股说明书。");

  const after = await (await fetch(`${base}/api/skills`)).json();
  assert.equal(after.skills.length, 1);
  assert.equal(after.skills[0].name, "prospectus-review");
  assert.match(after.skills[0].body, /revenue/);
});

await check("U14 PUT /api/skills 拒绝非法名和内置名", async () => {
  const badName = await fetch(`${base}/api/skills/Bad_Name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "描述。", body: "正文。" }),
  });
  assert.equal(badName.status, 400);

  const reserved = await fetch(`${base}/api/skills/consistency-review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "描述。", body: "正文。" }),
  });
  assert.equal(reserved.status, 409, "内置 skill 的名字不能被占用");
  const reservedBody = await reserved.json();
  assert.match(reservedBody.error, /内置 skill/);

  const noDescription = await fetch(`${base}/api/skills/no-description`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "  ", body: "正文。" }),
  });
  assert.equal(noDescription.status, 400);
});

await check("U15 POST /api/skills/import 只解析不落盘", async () => {
  const imported = await fetch(`${base}/api/skills/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "---\nname: policy-review\ndescription: 用于审查内部政策文件。\n---\n\n# 政策\n\n抽 approval_role。\n",
    }),
  });
  assert.equal(imported.status, 200);
  const importedBody = await imported.json();
  assert.equal(importedBody.skill.name, "policy-review");
  assert.equal(importedBody.skill.description, "用于审查内部政策文件。");
  assert.match(importedBody.skill.body, /approval_role/);

  const listed = await (await fetch(`${base}/api/skills`)).json();
  assert.ok(!listed.skills.some((skill) => skill.name === "policy-review"), "导入不应该落盘");

  const broken = await fetch(`${base}/api/skills/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "# 没有 front-matter\n" }),
  });
  assert.equal(broken.status, 400);
});

await check("U16 DELETE /api/skills 删掉一份，删不存在的报 404", async () => {
  const deleted = await fetch(`${base}/api/skills/prospectus-review`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const missing = await fetch(`${base}/api/skills/prospectus-review`, { method: "DELETE" });
  assert.equal(missing.status, 404);
  const listed = await (await fetch(`${base}/api/skills`)).json();
  assert.deepEqual(listed.skills, []);
});

await check("U17 使用者的 skill 被写进使用者自己的目录", async () => {
  await fetch(`${base}/api/skills/financial-review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "用于审查财报。", body: "本领域抽 revenue。" }),
  });
  const stored = await readFile(resolve(serverRoot, "skills", "financial-review", "SKILL.md"), "utf8");
  assert.match(stored, /name: financial-review/);
  assert.match(stored, /description: 用于审查财报。/);
  const { frontmatter, body, warnings } = parseFrontmatter(stored);
  assert.deepEqual(warnings, []);
  assert.equal(frontmatter.name, "financial-review");
  assert.ok(!("disable-model-invocation" in frontmatter), "不能让使用者 skill 路由不到");
  assert.match(body, /revenue/);
});

server.close();
await rm(serverRoot, { recursive: true, force: true });

// ── 8. 审查时领域 skill 真的能被加载 ───────────────────────
function scriptedModels() {
  const model = (id, input) => ({
    id,
    name: `Scripted ${id}`,
    api: "openai-responses",
    provider: "test-provider",
    baseUrl: "https://unused.invalid",
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 32_000,
    maxTokens: 2_000,
  });
  const main = model("main-text", ["text"]);
  const vision = model("vision-test", ["text", "image"]);
  return {
    getModel: (provider, id) => (provider === "test-provider" ? (id === "main-text" ? main : id === "vision-test" ? vision : undefined) : undefined),
    checkAuth: async (provider) => (provider === "test-provider" ? { type: "api_key" } : undefined),
  };
}

function scriptedStream(content, stopReason) {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: stopReason === "toolUse" ? "toolUse" : "stop",
    message: {
      role: "assistant",
      content,
      api: "openai-responses",
      provider: "test-provider",
      model: "main-text",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason,
      timestamp: Date.now(),
    },
  });
  return stream;
}

await check("U18 审查时领域 skill 在索引里，而且能被 agent 加载进对话", async () => {
  const models = scriptedModels();
  let index = 0;
  let firstContext = "";
  const calls = [
    { type: "toolCall", id: "call-1", name: "load_document_skill", arguments: { skill: "prospectus-review" } },
  ];
  models.streamSimple = (_model, context) => {
    if (!firstContext) firstContext = JSON.stringify(context);
    const call = calls[index++];
    if (!call) return scriptedStream([{ type: "text", text: "审查完成。" }], "stop");
    return scriptedStream([call], "toolUse");
  };

  await runConsistencyReview({
    documents: [{ id: "doc-a", title: "招股书.pdf", path: "/tmp/prospectus.pdf" }],
    models,
    mainProfile: { role: "main", provider: "test-provider", modelId: "main-text", apiKey: "scripted-key" },
    visionProfile: { role: "vision", provider: "test-provider", modelId: "vision-test", apiKey: "scripted-key" },
    userSkillsRoot: userRoot,
    parseDocument: async (_path, options) => ({
      id: options.id,
      title: options.title,
      format: "pdf",
      pages: [{ page: 1, text: "收入为 USD 1200。", blocks: [], pageBounds: [0, 0, 612, 792], classification: "text-native", extractionMethod: "native-text" }],
      blocks: [],
      text: "收入为 USD 1200。",
      markdown: "收入为 USD 1200。",
      warnings: [],
    }),
  });

  assert.match(firstContext, /<name>prospectus-review<\/name>/, "领域 skill 不在系统提示的索引里");
  assert.match(firstContext, /用于审查证券招股说明书。/, "领域 skill 的描述应该进索引，agent 靠它路由");
  assert.match(firstContext, /<skill name=\\"consistency-review\\"/, "第一轮对话里应该有审查流程 skill 的正文");

  // 领域 skill 的正文被 load_document_skill 拉进对话之后，agent 就能按它抽 key。
  const loaded = await readUserSkill(userRoot, "prospectus-review");
  assert.match(loaded.body, /revenue/, "领域 skill 的正文里应该有该领域抽什么");
});

await rm(userRoot, { recursive: true, force: true });

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`  ${entry.ok ? "ok" : "FAIL"}  ${entry.name}${entry.ok ? "" : `\n        ${entry.message}`}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
