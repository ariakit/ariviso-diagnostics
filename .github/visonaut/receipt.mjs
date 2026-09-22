import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { digestJson, results, shardIdentity } from "./identity.mjs";
const shard = shardIdentity();
const receipt = JSON.parse(await readFile(path.join(results, "receipt.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(results, "manifest.json"), "utf8"));
const expected = `visonaut-discovery-${manifest.run.workflowAttempt}-${manifest.shard.jobId}-${encodeURIComponent(shard.key)}-${digestJson(manifest)}`;
if (receipt.artifactName !== expected || receipt.manifestDigest !== digestJson(manifest))
  throw new Error("The reporter receipt does not bind this complete manifest");
await appendFile(process.env.GITHUB_OUTPUT, `name=${receipt.artifactName}\n`);
