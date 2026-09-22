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

test("the OIDC workflow checks out only the pinned trusted executor", async () => {
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
  assert.equal([...workflow.matchAll(/GH_TOKEN: \$\{\{ github\.token \}\}/g)].length, 1);
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
