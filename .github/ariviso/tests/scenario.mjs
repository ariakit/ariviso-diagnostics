import { readFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "../identity.mjs";
import { sanitizeScenario } from "../scenario.mjs";
export async function scenario() {
  return sanitizeScenario(
    JSON.parse(await readFile(path.join(repositoryRoot, "scenario.json"), "utf8")),
  );
}
export async function scene(page, color, second = false) {
  const colors = { blue: "#2457d6", green: "#16834a", red: "#cc3344" };
  await page.setContent(
    `<style>html,body{margin:0;background:#f5f6fa}div{position:absolute;left:${second ? 32 : 16}px;top:24px;width:96px;height:72px;background:${colors[color]};border-radius:8px}</style><div></div>`,
  );
}
