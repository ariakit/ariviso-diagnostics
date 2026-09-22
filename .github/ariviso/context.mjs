import { writeFile } from "node:fs/promises";
import path from "node:path";
import { results, settings, shardIdentity } from "./identity.mjs";
import { loadPlan } from "./plan.mjs";
import { writeScenario } from "./scenario.mjs";
const config = await settings();
const shard = shardIdentity();
const { planDigest, mainSha } = await loadPlan();
const endpoint = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
endpoint.searchParams.set("audience", new URL(config.server).origin);
const response = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`OIDC request failed (${response.status})`);
const { value } = await response.json();
// This locates the current job only. The service verifies the actual JWT.
const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
const workflowRunId = process.env.GITHUB_RUN_ID;
const workflowAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
const testedSha = process.env.GITHUB_SHA;
if (
  !/^[1-9][0-9]*$/.test(workflowRunId) ||
  !Number.isSafeInteger(workflowAttempt) ||
  workflowAttempt < 1 ||
  !/^[a-f0-9]{40}$/.test(testedSha)
)
  throw new Error("Invalid workflow capture context");
const jobsResponse = await fetch(
  `https://api.github.com/repos/${config.repository}/actions/runs/${workflowRunId}/attempts/${workflowAttempt}/jobs?per_page=100`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  },
);
if (!jobsResponse.ok) throw new Error(`Current workflow jobs unavailable (${jobsResponse.status})`);
const jobs = await jobsResponse.json();
const matches = jobs.jobs.filter(
  (job) =>
    job.name === `capture / ${shard.key}` &&
    job.check_run_url ===
      `https://api.github.com/repos/${config.repository}/check-runs/${claims.check_run_id}` &&
    job.run_id === Number(workflowRunId) &&
    job.run_attempt === workflowAttempt,
);
if (matches.length !== 1) throw new Error("The signed current job is missing or ambiguous");
await writeScenario({ repository: config.repository, testedSha, token: process.env.GH_TOKEN });
await writeFile(
  path.join(results, "context.json"),
  `${JSON.stringify({ workflowRunId, workflowAttempt, testedSha, jobId: String(matches[0].id), planDigest, mainSha }, null, 2)}\n`,
);
console.log(
  `Bound ${shard.key} to workflow attempt ${workflowAttempt} and tested SHA ${testedSha}`,
);
