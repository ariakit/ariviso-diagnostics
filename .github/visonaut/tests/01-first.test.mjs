import { test } from "@playwright/test";
import { visual } from "@visonaut/playwright";
import { scenario, scene } from "./scenario.mjs";
test("first synthetic card", async ({ page }) => {
  const candidate = await scenario();
  await scene(page, candidate.color);
  await visual(page, {
    item: "synthetic/first",
    name: "First synthetic card",
    variant: { key: "chromium-light", browser: "chromium", colorScheme: "light" },
  });
});
