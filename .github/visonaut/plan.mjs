import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  collectionFor,
  digestJson,
  executorDigest,
  results,
  settings,
} from "./identity.mjs";
export const invocation = [
  "playwright",
  "test",
  "--config",
  "visonaut-harness/playwright.config.mjs",
];
export async function validatePlan(plan) {
  const config = await settings();
  if (
    plan.schemaVersion !== "1.0" ||
    plan.repositoryId !== config.repositoryId ||
    plan.workflow !== config.workflow ||
    canonicalJson(plan.invocation) !== canonicalJson(invocation) ||
    plan.discovery?.executorDigest !== (await executorDigest()) ||
    !Array.isArray(plan.shards) ||
    plan.shards.length !== 2
  )
    throw new Error("The main plan does not match the immutable diagnostic executor");
  for (const number of [1, 2]) {
    const key = `chromium-${number}`;
    const matches = plan.shards.filter((item) => item.key === key);
    if (matches.length !== 1)
      throw new Error("The main plan must contain both fixed shards exactly once");
    const shard = matches[0];
    if (
      shard.jobName !== `capture / ${key}` ||
      canonicalJson(shard.collection) !== canonicalJson(collectionFor(number)) ||
      !Array.isArray(shard.environmentProfileDigests) ||
      !shard.environmentProfileDigests.length ||
      shard.environmentProfileDigests.some((item) => !/^[a-f0-9]{64}$/.test(item))
    )
      throw new Error("The main plan changed the trusted collection or environment policy");
  }
  return plan;
}
async function github(pathname) {
  const config = await settings();
  const response = await fetch(`https://api.github.com/repos/${config.repository}/${pathname}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Trusted main metadata is unavailable (${response.status})`);
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
    throw new Error("Trusted main metadata exceeds the byte bound");
  return JSON.parse(bytes);
}
export async function loadPlan() {
  const config = await settings();
  const branch = await github("git/ref/heads/main");
  const mainSha = branch.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(mainSha)) throw new Error("The trusted main commit is unavailable");
  const file = await github(`contents/${config.planPath}?ref=${mainSha}`);
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string")
    throw new Error("The main plan is not a JSON file");
  const plan = await validatePlan(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
  await mkdir(results, { recursive: true });
  await writeFile(path.join(results, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  return { plan, planDigest: digestJson(plan), mainSha };
}
