import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { digestJson, repositoryRoot, results, settings, shardIdentity } from "./identity.mjs";
import { validatePlan } from "./plan.mjs";
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true")
  throw new Error("Diagnostic capture requires GitHub Actions");
const config = await settings();
const shard = shardIdentity();
const plan = await validatePlan(
  JSON.parse(await readFile(path.join(results, "plan.json"), "utf8")),
);
const context = JSON.parse(await readFile(path.join(results, "context.json"), "utf8"));
const environment = JSON.parse(
  await readFile(path.join(results, `environment-${shard.key}.json`), "utf8"),
);
const expected = plan.shards.find((item) => item.key === shard.key);
if (
  environment.environmentProfiles.length !== 1 ||
  environment.environmentProfiles.some(
    (item) =>
      digestJson(item.profile) !== item.digest ||
      !expected.environmentProfileDigests.includes(item.digest),
  ) ||
  context.planDigest !== digestJson(plan)
)
  throw new Error("The measured capture profile or plan is not registered");
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  repeatEach: 1,
  testDir: path.join(repositoryRoot, "visonaut-harness/tests"),
  testMatch: ["**/*.test.mjs"],
  testIgnore: [],
  grep: /.*/,
  grepInvert: [],
  shard: { current: shard.number, total: 2 },
  outputDir: path.join(repositoryRoot, ".visonaut-test-results"),
  reporter: [
    ["github"],
    ["dot"],
    [
      "@visonaut/playwright/reporter",
      {
        outputFile: path.join(results, "manifest.json"),
        repositoryRoot,
        plan,
        run: {
          repository: config.repository,
          repositoryId: config.repositoryId,
          workflowRunId: context.workflowRunId,
          workflowAttempt: context.workflowAttempt,
          testedSha: context.testedSha,
          planDigest: context.planDigest,
        },
        shard: { key: shard.key, jobId: context.jobId, sourceAttempt: context.workflowAttempt },
      },
    ],
  ],
  projects: [
    {
      name: "chromium",
      metadata: { visonaut: { profile: environment.profile } },
      use: {
        browserName: "chromium",
        viewport: { width: 160, height: 120 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
        colorScheme: "light",
        contrast: "no-preference",
        forcedColors: "none",
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
  ],
});
