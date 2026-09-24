import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runProbes } from "./probe.mjs";

const origin = "https://ariviso-diagnostics.ariakit.workers.dev";
const environment = {
  GITHUB_REPOSITORY: "ariakit/ariviso-diagnostics",
  GITHUB_REPOSITORY_ID: "1380792062",
  GITHUB_RUN_ID: "123456",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "a".repeat(40),
};
const plan = { schemaVersion: "1.0", repositoryId: "1380792062", shards: [] };
const permission = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/idtoken?request=fixture",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-runner-request-token",
};

function fixture(reject) {
  const calls = [];
  const reports = [];
  const fetcher = async (input, options) => {
    const url = new URL(input);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    calls.push({ url, options });
    if (url.hostname === "api.github.com") {
      if (url.pathname.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: "b".repeat(40) } });
      }
      assert.equal(url.searchParams.get("ref"), "b".repeat(40));
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(plan)).toString("base64"),
      });
    }
    if (url.hostname === "run.actions.githubusercontent.com") {
      assert.equal(options.headers.Authorization, "Bearer synthetic-runner-request-token");
      const wrong = url.searchParams.get("audience") === `${origin}/wrong-audience`;
      return Response.json({
        value: wrong ? "synthetic.wrong.audience" : "synthetic.correct.audience",
      });
    }
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/v1/runs");
    assert.equal(options.method, "POST");
    if (reject) {
      return reject();
    }
    const authorization = options.headers.Authorization;
    const code = !authorization
      ? "credential_required"
      : authorization.includes(".wrong.")
        ? "invalid_oidc"
        : "untrusted_run";
    return Response.json(
      { schemaVersion: "1.0", error: { code } },
      { status: code === "untrusted_run" ? 403 : 401 },
    );
  };
  return { fetcher, calls, reports, report: (value) => reports.push(JSON.parse(value)) };
}

test("the job without OIDC permission sends no bearer credential", async () => {
  const state = fixture();
  await runProbes({ mode: "without-token", environment, ...state });
  const upload = state.calls.find((call) => call.url.origin === origin);
  assert.ok(upload);
  assert.equal(upload.options.headers.Authorization, undefined);
  assert.equal(
    state.calls.some((call) => call.url.hostname.endsWith(".actions.githubusercontent.com")),
    false,
  );
  assert.deepEqual(state.reports, [
    { case: "missing-bearer", status: 401, code: "credential_required", result: "PASS" },
    { workflowRunId: "123456", workflowAttempt: 2, mode: "without-token", result: "PASS" },
  ]);
});

test("real-token probes use separate audiences and fixed invalid provenance", async () => {
  const state = fixture();
  await runProbes({ mode: "with-token", environment: { ...environment, ...permission }, ...state });
  const identities = state.calls.filter(
    (call) => call.url.hostname === "run.actions.githubusercontent.com",
  );
  assert.deepEqual(
    identities.map((call) => call.url.searchParams.get("audience")),
    [`${origin}/wrong-audience`, origin],
  );
  const reserves = state.calls
    .filter((call) => call.url.origin === origin)
    .map((call) => JSON.parse(call.options.body));
  assert.equal(reserves.length, 4);
  assert.deepEqual(
    reserves.slice(0, 2).map((body) => body.testedSha),
    [environment.GITHUB_SHA, environment.GITHUB_SHA],
  );
  assert.equal(reserves[2].repository, "ariakit/ariakit");
  assert.equal(reserves[2].repositoryId, "104133653");
  assert.equal(reserves[3].testedSha, "dcf42788b6c284a1affb4d2df65954672b04bae0");
  assert.match(reserves[0].planDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    state.reports.map((entry) => entry.result),
    ["PASS", "PASS", "PASS", "PASS", "PASS"],
  );
  assert.equal(JSON.stringify(state.reports).includes("synthetic."), false);
});

test("unexpected HTTP success fails without logging a capability or response body", async () => {
  const state = fixture(() =>
    Response.json(
      {
        schemaVersion: "1.0",
        error: { code: "credential_required" },
        capability: "never-log-this-value",
      },
      { status: 201 },
    ),
  );
  await assert.rejects(runProbes({ mode: "without-token", environment, ...state }));
  assert.deepEqual(state.reports, [{ case: "missing-bearer", status: 201, result: "FAIL" }]);
});

test("the expected HTTP status with the wrong rejection code still fails", async () => {
  const state = fixture(() =>
    Response.json(
      { schemaVersion: "1.0", error: { code: "private-response-do-not-log" } },
      { status: 401 },
    ),
  );
  await assert.rejects(runProbes({ mode: "without-token", environment, ...state }));
  assert.deepEqual(state.reports, [{ case: "missing-bearer", status: 401, result: "FAIL" }]);
});

test("responses are bounded before JSON parsing", async () => {
  const state = fixture(() => new Response("x".repeat(65_537), { status: 401 }));
  await assert.rejects(runProbes({ mode: "without-token", environment, ...state }), /byte limit/);
  assert.deepEqual(state.reports, []);
});

test("the no-permission job refuses unexpected OIDC credentials", async () => {
  const state = fixture();
  await assert.rejects(
    runProbes({ mode: "without-token", environment: { ...environment, ...permission }, ...state }),
    /unexpectedly exposes/,
  );
  assert.equal(
    state.calls.some((call) => call.url.origin === origin),
    false,
  );
});

test("a repository mismatch makes no HTTP request", async () => {
  const state = fixture();
  await assert.rejects(
    runProbes({
      mode: "with-token",
      environment: { ...environment, GITHUB_REPOSITORY: "other/repository", ...permission },
      ...state,
    }),
  );
  assert.deepEqual(state.calls, []);
});

test("the runner request credential cannot be sent to another host", async () => {
  const state = fixture();
  await assert.rejects(
    runProbes({
      mode: "with-token",
      environment: {
        ...environment,
        ...permission,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/idtoken",
      },
      ...state,
    }),
    /GitHub OIDC endpoint/,
  );
  assert.equal(
    state.calls.some((call) => call.url.hostname === "example.invalid"),
    false,
  );
});

test("the workflow exposes id-token permission only in its untrusted dispatch job", async () => {
  const workflow = await readFile(
    new URL("../workflows/ariviso-oidc-negative.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.match(/id-token: write/g)?.length, 1);
  assert.equal(workflow.match(/if: github.event_name == 'workflow_dispatch'/g)?.length, 2);
  assert.equal(workflow.includes("secrets:"), false);
  assert.equal(workflow.includes("upload-artifact"), false);
});
