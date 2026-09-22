import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { digestJson, results, settings, sha256, shardIdentity } from "./identity.mjs";
async function fonts(directory, relative = "") {
  let entries;
  try {
    entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await fonts(directory, file)));
    else if (/\.(ttf|otf|ttc|woff2?)$/i.test(file))
      files.push({
        file: file.split(path.sep).join("/"),
        digest: sha256(await readFile(path.join(directory, file))),
      });
  }
  return files.sort((a, b) => a.file.localeCompare(b.file, "en"));
}
const config = await settings();
const shard = shardIdentity();
const measuredFonts = [];
const fontRoots =
  process.platform === "darwin"
    ? ["/System/Library/Fonts", "/Library/Fonts"]
    : ["/usr/share/fonts", "/usr/local/share/fonts"];
for (const [index, root] of fontRoots.entries()) {
  for (const file of await fonts(root)) measuredFonts.push({ root: index, ...file });
}
if (!measuredFonts.length) throw new Error("The diagnostic runner has no measured fonts");
const osImage = {
  os: process.env.ImageOS ?? process.platform,
  imageVersion: process.env.ImageVersion ?? "local-probe-only",
  architecture: process.arch,
};
const profile = {
  osImageDigest: digestJson(osImage),
  fontsDigest: digestJson(measuredFonts),
  comparisonPolicyDigest: digestJson(config.comparisonPolicy),
  comparisonEngineVersion: config.comparisonEngineVersion,
};
const browser = await chromium.launch();
let captureProfile;
try {
  const context = await browser.newContext({
    viewport: { width: 160, height: 120 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    contrast: "no-preference",
    forcedColors: "none",
  });
  const page = await context.newPage();
  const media = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    deviceScaleFactor: devicePixelRatio,
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduce"
      : "no-preference",
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    contrast: matchMedia("(prefers-contrast: more)").matches ? "more" : "no-preference",
    forcedColors: matchMedia("(forced-colors: active)").matches ? "active" : "none",
  }));
  captureProfile = {
    ...profile,
    browser: "chromium",
    browserVersion: browser.version(),
    ...media,
    animationPolicy: "disabled",
    captureOptions: {
      type: "png",
      animations: "disabled",
      caret: "hide",
      scale: "css",
      fullPage: false,
      omitBackground: false,
    },
  };
} finally {
  await browser.close();
}
await mkdir(results, { recursive: true });
await writeFile(
  path.join(results, `environment-${shard.key}.json`),
  `${JSON.stringify({ shard: shard.key, osImage, profile, fonts: measuredFonts, environmentProfiles: [{ digest: digestJson(captureProfile), profile: captureProfile }] }, null, 2)}\n`,
);
console.log(`Measured one ${shard.key} profile and ${measuredFonts.length} system fonts`);
