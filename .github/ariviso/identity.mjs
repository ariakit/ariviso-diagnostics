import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export const repositoryRoot = realpathSync(process.env.GITHUB_WORKSPACE ?? process.cwd());
export const results = path.join(repositoryRoot, ".ariviso-results");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digestJson = (value) => sha256(canonicalJson(value));
export async function settings() {
  return JSON.parse(await readFile(new URL("settings.json", import.meta.url), "utf8"));
}
export async function executorDigest(directory = import.meta.dirname) {
  const files = [];
  async function visit(relative = "") {
    for (const item of (
      await readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (item.name === "node_modules") continue;
      const file = path.join(relative, item.name);
      if (item.isDirectory()) await visit(file);
      else if (/\.(mjs|json)$/.test(file))
        files.push({
          file: file.split(path.sep).join("/"),
          digest: sha256(await readFile(path.join(directory, file))),
        });
    }
  }
  await visit();
  return digestJson(files);
}
export function shardIdentity(value = process.env.ARIVISO_SHARD) {
  const number = Number(value);
  if (number !== 1 && number !== 2) throw new Error("The trusted shard must be 1 or 2");
  return { key: `chromium-${number}`, number };
}
export function collectionFor(number) {
  return {
    projectName: "chromium",
    testDir: "ariviso-harness/tests",
    testMatch: ["**/*.test.mjs"],
    testIgnore: [],
    grep: [{ source: ".*", flags: "" }],
    grepInvert: [],
    shard: { current: number, total: 2 },
    repeatEach: 1,
  };
}
