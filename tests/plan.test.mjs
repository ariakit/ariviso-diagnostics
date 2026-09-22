import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionFor, executorDigest, settings } from "../.github/visonaut/identity.mjs";
import { invocation, validatePlan } from "../.github/visonaut/plan.mjs";
async function plan() {
  const config = await settings();
  return {
    schemaVersion: "1.0",
    repositoryId: config.repositoryId,
    workflow: config.workflow,
    invocation,
    discovery: { executorDigest: await executorDigest() },
    shards: [1, 2].map((number) => ({
      key: `chromium-${number}`,
      jobName: `capture / chromium-${number}`,
      collection: collectionFor(number),
      environmentProfileDigests: ["a".repeat(64)],
    })),
  };
}
test("both complete fixed collections validate", async () => {
  const value = await plan();
  assert.equal(await validatePlan(value), value);
});
test("an omitted shard cannot authorize a partial run", async () => {
  const value = await plan();
  value.shards.pop();
  await assert.rejects(validatePlan(value), /immutable/);
});
test("PR-selected filters cannot replace the fixed collection", async () => {
  const value = await plan();
  value.shards[0].collection.grep = [{ source: "first", flags: "" }];
  await assert.rejects(validatePlan(value), /collection/);
});
test("main configuration cannot replace the pinned executable source", async () => {
  const value = await plan();
  value.discovery.executorDigest = "b".repeat(64);
  await assert.rejects(validatePlan(value), /immutable/);
});
test("capture does not accept an unregistered profile allowlist", async () => {
  const value = await plan();
  value.shards[1].environmentProfileDigests = [];
  await assert.rejects(validatePlan(value), /environment/);
});
