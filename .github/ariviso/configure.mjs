import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectionFor,
  digestJson,
  executorDigest,
  repositoryRoot,
  settings,
} from "./identity.mjs";
import { invocation, validatePlan } from "./plan.mjs";
const files = process.argv.slice(2);
if (files.length !== 2)
  throw new Error(
    "Supply both downloaded environment-chromium-1.json and environment-chromium-2.json files",
  );
const config = await settings();
const profiles = new Set();
const shards = new Set();
for (const file of files) {
  const measured = JSON.parse(await readFile(file, "utf8"));
  if (
    !["chromium-1", "chromium-2"].includes(measured.shard) ||
    shards.has(measured.shard) ||
    measured.osImage.imageVersion === "local-probe-only" ||
    measured.environmentProfiles.length !== 1
  )
    throw new Error("Use one hosted probe result per fixed shard");
  shards.add(measured.shard);
  for (const entry of measured.environmentProfiles) {
    if (
      entry.digest !== digestJson(entry.profile) ||
      entry.profile.comparisonPolicyDigest !== digestJson(config.comparisonPolicy) ||
      entry.profile.comparisonEngineVersion !== config.comparisonEngineVersion
    )
      throw new Error("The measured profile does not match this diagnostic policy");
    profiles.add(entry.digest);
  }
}
const plan = await validatePlan({
  schemaVersion: "1.0",
  repositoryId: config.repositoryId,
  workflow: config.workflow,
  invocation,
  discovery: { executorDigest: await executorDigest() },
  shards: [1, 2].map((number) => ({
    key: `chromium-${number}`,
    jobName: `capture / chromium-${number}`,
    collection: collectionFor(number),
    environmentProfileDigests: [...profiles].sort(),
  })),
});
const destination = path.join(repositoryRoot, config.planPath);
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`);
console.log(
  JSON.stringify(
    { planDigest: digestJson(plan), executorDigest: plan.discovery.executorDigest },
    null,
    2,
  ),
);
