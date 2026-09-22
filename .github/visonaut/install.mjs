import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, settings, sha256 } from "./identity.mjs";
const config = await settings();
const directory = path.join(repositoryRoot, ".visonaut-packages");
await mkdir(directory, { recursive: true });
const archives = [];
for (const [name, artifact] of Object.entries(config.packages)) {
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256))
    throw new Error(`Pin the reviewed ${name} tarball before capture`);
  const url = new URL(process.env[artifact.urlEnvironment]);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("A direct HTTPS package URL is required");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body)
    throw new Error(`Package download failed with HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10 * 1024 * 1024) throw new Error("The package archive exceeds its byte limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (sha256(bytes) !== artifact.sha256)
    throw new Error(`The ${name} package SHA-256 does not match`);
  const archive = path.join(directory, `${name}.tgz`);
  await writeFile(archive, bytes);
  archives.push(archive);
}
const result = spawnSync(
  "npm",
  [
    "install",
    "--no-save",
    "--package-lock=false",
    "--ignore-scripts",
    "--audit=false",
    "--fund=false",
    ...archives,
  ],
  { cwd: import.meta.dirname, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Pinned client installation failed (${result.status})`);
