import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fetchScenario, sanitizeScenario, writeScenario } from "../.github/visonaut/scenario.mjs";

const repository = "ariakit/visonaut-diagnostics";
const testedSha = "a".repeat(40);
const token = "fixture-read-token";
const candidate = {
  color: "blue",
  failSecondShardOnFirstAttempt: false,
  retrySecondTestOnce: true,
};
function file(value = candidate, changes = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    type: "file",
    path: "scenario.json",
    encoding: "base64",
    size: bytes.length,
    content: bytes.toString("base64"),
    ...changes,
  };
}
function options(value = file()) {
  return { repository, testedSha, token, fetchImpl: async () => Response.json(value) };
}

test("only the tested scenario is fetched and no candidate tooling file enters the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visonaut-scenario-"));
  try {
    const candidateDirectory = path.join(root, "candidate");
    const workspace = path.join(root, "capture");
    await mkdir(candidateDirectory);
    await mkdir(workspace);
    await writeFile(path.join(candidateDirectory, "scenario.json"), JSON.stringify(candidate));
    await writeFile(
      path.join(candidateDirectory, "package.json"),
      JSON.stringify({ name: "hostile-workspace", workspaces: ["visonaut-harness"] }),
    );
    await writeFile(
      path.join(candidateDirectory, "jsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@playwright/test": ["./hostile.mjs"] } } }),
    );
    await writeFile(
      path.join(candidateDirectory, "hostile.mjs"),
      "throw new Error('candidate code executed');",
    );
    const requests = [];
    await writeScenario(
      {
        repository,
        testedSha,
        token,
        async fetchImpl(url, init) {
          requests.push(url);
          assert.equal(
            url,
            `https://api.github.com/repos/${repository}/contents/scenario.json?ref=${testedSha}`,
          );
          assert.equal(init.redirect, "error");
          assert.equal(init.headers.Authorization, `Bearer ${token}`);
          const data = JSON.parse(
            await readFile(path.join(candidateDirectory, "scenario.json"), "utf8"),
          );
          return Response.json(file(data));
        },
      },
      workspace,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(await readdir(workspace), ["scenario.json"]);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(workspace, "scenario.json"), "utf8")),
      candidate,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("render and signed upload keep the pinned executor and artifact boundary", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/visonaut-capture.yml", import.meta.url),
    "utf8",
  );
  const checkouts = [
    ...workflow.matchAll(/uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=\n      -)/g),
  ];
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0][1], /repository: ariakit\/visonaut-diagnostics/);
  assert.match(checkouts[0][1], /ref: \$\{\{ env\.VISONAUT_EXECUTOR_SOURCE \}\}/);
  assert.match(checkouts[0][1], /path: \.visonaut-trusted/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.sha \}\}/);
  const render = workflow.split("\n  render_first:")[1]?.split("\n  render_second:")[0];
  const secondRender = workflow.split("\n  render_second:")[1]?.split("\n  capture_first:")[0];
  const upload = workflow.split("\n  capture_first:")[1]?.split("\n  capture_second:")[0];
  const secondUpload = workflow.split("\n  capture_second:")[1]?.split("\n  submit:")[0];
  const submit = workflow.split("\n  submit:\n")[1];
  assert.ok(render);
  assert.ok(secondRender);
  assert.ok(upload);
  assert.ok(secondUpload);
  assert.ok(submit);
  assert.match(render, /permissions:\n      contents: read/);
  assert.doesNotMatch(render, /id-token: write/);
  assert.match(render, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(secondRender, /permissions:\n      contents: read/);
  assert.doesNotMatch(secondRender, /id-token: write/);
  assert.match(secondRender, /steps: \*render_steps/);
  assert.match(upload, /permissions:\n      actions: read\n      id-token: write/);
  assert.match(upload, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(secondUpload, /permissions:\n      actions: read\n      id-token: write/);
  assert.match(secondUpload, /steps: \*capture_steps/);
  const transferRetention = Number(render.match(/retention-days: (\d+)/)?.[1]);
  assert.ok(transferRetention >= 70);
  assert.match(submit, /needs: \[capture_first, capture_second\]/);
  assert.match(submit, /permissions:\n      id-token: write/);
  assert.match(submit, /node "\$VISONAUT_CLI_BIN" submit --run "\$GITHUB_RUN_ID"/);
  const artifactPaths = [
    ...workflow.matchAll(
      /- uses: actions\/upload-artifact@[^\n]+\n\s+with:\n\s+name: [^\n]+\n\s+path: ([^\n]+)/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(artifactPaths, [
    "${{ runner.temp }}/visonaut-${{ env.VISONAUT_SHARD }}.enc",
    "${{ runner.temp }}/visonaut-submission-${{ env.VISONAUT_SHARD }}/receipt.json",
  ]);
});

test("unknown scenario fields, nested values and invalid primitive values fail closed", () => {
  for (const value of [
    null,
    [],
    { ...candidate, package: { workspaces: ["visonaut-harness"] } },
    { ...candidate, color: "url(https://example.invalid)" },
    { ...candidate, retrySecondTestOnce: "true" },
    { color: "blue" },
  ]) {
    assert.throws(() => sanitizeScenario(value), /three fixed/);
  }
  const sanitized = sanitizeScenario(candidate);
  assert.notEqual(sanitized, candidate);
  assert.deepEqual(sanitized, candidate);
});

test("the scenario requires a full tested SHA, a regular fixed-path file, and exact base64 bytes", async () => {
  await assert.rejects(fetchScenario({ ...options(), testedSha: "main" }), /full tested SHA/);
  for (const value of [
    file(candidate, { type: "symlink" }),
    file(candidate, { path: "jsconfig.json" }),
    file(candidate, { size: 1025 }),
    file(candidate, { encoding: "none" }),
    file(candidate, { content: "!!!!" }),
  ]) {
    await assert.rejects(fetchScenario(options(value)));
  }
});

test("oversized response streams are canceled and never produce a scenario file", async () => {
  let canceled = false;
  const root = await mkdtemp(path.join(os.tmpdir(), "visonaut-scenario-limit-"));
  try {
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(16 * 1024 + 1));
        },
        cancel() {
          canceled = true;
        },
      }),
    );
    await assert.rejects(
      writeScenario({ ...options(), fetchImpl: async () => response }, root),
      /byte limit/,
    );
    assert.equal(canceled, true);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed GitHub reads do not write a fallback scenario", async () => {
  await assert.rejects(
    fetchScenario({
      ...options(),
      fetchImpl: async () => new Response("unavailable", { status: 404 }),
    }),
    /unavailable/,
  );
});
