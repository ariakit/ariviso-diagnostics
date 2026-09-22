import { test } from "@playwright/test";
import { visual } from "@visonaut/playwright";
import { scenario, scene } from "./scenario.mjs";
test("second synthetic card", async ({ page }, info) => {
  const candidate = await scenario();
  const retry = candidate.retrySecondTestOnce && info.retry === 0;
  await scene(page, retry ? "red" : candidate.color, true);
  await visual(page, {
    item: "synthetic/second",
    name: "Second synthetic card",
    variant: { key: "chromium-light", browser: "chromium", colorScheme: "light" },
  });
  if (candidate.failSecondShardOnFirstAttempt && process.env.GITHUB_RUN_ATTEMPT === "1")
    throw new Error("Intentional failed-shard fixture; rerun failed jobs to recover");
  if (retry)
    throw new Error("Intentional first Playwright attempt; only final successful pixels may seal");
});
