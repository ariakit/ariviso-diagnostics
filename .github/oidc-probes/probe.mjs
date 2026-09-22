import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const origin = "https://ariviso-diagnostics.ariakit.workers.dev";
const repository = "ariakit/ariviso-diagnostics";
const repositoryId = "1380792062";
const trustedWorkflowSha = "dcf42788b6c284a1affb4d2df65954672b04bae0";
const maximumBytes = 65_536;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJson(response) {
  if (!response.body) {
    throw new Error("A JSON response is required.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("The response exceeds the diagnostic byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function request(fetcher, url, options = {}) {
  return fetcher(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

async function loadPlan(fetcher) {
  const root = `https://api.github.com/repos/${repository}`;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const branch = await request(fetcher, `${root}/git/ref/heads/main`, { headers });
  if (!branch.ok) {
    throw new Error("The main ref is unavailable.");
  }
  const sha = (await readJson(branch)).object?.sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("The main ref is invalid.");
  }
  const file = await request(fetcher, `${root}/contents/.github/ariviso-plan.json?ref=${sha}`, {
    headers,
  });
  if (!file.ok) {
    throw new Error("The main plan is unavailable.");
  }
  const entry = await readJson(file);
  if (entry.type !== "file" || entry.encoding !== "base64" || typeof entry.content !== "string") {
    throw new Error("The main plan is not a file.");
  }
  const plan = JSON.parse(Buffer.from(entry.content, "base64").toString("utf8"));
  if (plan.schemaVersion !== "1.0" || plan.repositoryId !== repositoryId) {
    throw new Error("The main plan has the wrong identity.");
  }
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

async function identityToken({ fetcher, environment, audience }) {
  const endpoint = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".actions.githubusercontent.com") ||
    endpoint.username ||
    endpoint.password ||
    !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error("A GitHub OIDC endpoint is required.");
  }
  endpoint.searchParams.set("audience", audience);
  const response = await request(fetcher, endpoint, {
    headers: { Authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error("GitHub did not issue the diagnostic token.");
  }
  const payload = await readJson(response);
  if (typeof payload.value !== "string" || !/^[A-Za-z0-9_.-]+$/.test(payload.value)) {
    throw new Error("GitHub returned an invalid token response.");
  }
  return payload.value;
}

export async function runProbes({ mode, environment, fetcher = fetch, report = console.log }) {
  if (mode !== "without-token" && mode !== "with-token") {
    throw new Error("Select the diagnostic permission mode.");
  }
  if (
    environment.GITHUB_REPOSITORY !== repository ||
    environment.GITHUB_REPOSITORY_ID !== repositoryId ||
    !/^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ID ?? "") ||
    !/^[1-9][0-9]*$/.test(environment.GITHUB_RUN_ATTEMPT ?? "") ||
    !Number.isSafeInteger(Number(environment.GITHUB_RUN_ATTEMPT)) ||
    !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? "")
  ) {
    throw new Error("The diagnostic workflow identity is invalid.");
  }
  const body = {
    schemaVersion: "1.0",
    repository,
    repositoryId,
    workflowRunId: environment.GITHUB_RUN_ID,
    workflowAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    testedSha: environment.GITHUB_SHA,
    planDigest: await loadPlan(fetcher),
    shardKey: "chromium-1",
  };
  const expectDenied = async ({ name, token, overrides = {}, status, code }) => {
    const response = await request(fetcher, `${origin}/v1/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...body, ...overrides }),
    });
    // Never print a response body: a broken service could return a capability.
    if (response.status !== status) {
      await response.body?.cancel();
      report(JSON.stringify({ case: name, status: response.status, result: "FAIL" }));
      throw new Error("The service did not reject the diagnostic request as expected.");
    }
    const payload = await readJson(response);
    if (payload.schemaVersion !== "1.0" || payload.error?.code !== code) {
      report(JSON.stringify({ case: name, status, result: "FAIL" }));
      throw new Error("The service returned an unexpected rejection code.");
    }
    report(JSON.stringify({ case: name, status, code, result: "PASS" }));
  };
  if (mode === "without-token") {
    if (environment.ACTIONS_ID_TOKEN_REQUEST_URL || environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
      throw new Error("The no-permission job unexpectedly exposes OIDC credentials.");
    }
    await expectDenied({ name: "missing-bearer", status: 401, code: "credential_required" });
  } else {
    const wrongAudience = await identityToken({
      fetcher,
      environment,
      audience: `${origin}/wrong-audience`,
    });
    await expectDenied({
      name: "wrong-audience",
      token: wrongAudience,
      status: 401,
      code: "invalid_oidc",
    });
    const token = await identityToken({ fetcher, environment, audience: origin });
    await expectDenied({
      name: "untrusted-workflow-job",
      token,
      status: 403,
      code: "untrusted_run",
    });
    await expectDenied({
      name: "untrusted-workflow-wrong-repository",
      token,
      overrides: { repository: "ariakit/ariakit", repositoryId: "104133653" },
      status: 403,
      code: "untrusted_run",
    });
    await expectDenied({
      name: "untrusted-workflow-spoofed-tested-sha",
      token,
      overrides: { testedSha: trustedWorkflowSha },
      status: 403,
      code: "untrusted_run",
    });
  }
  report(
    JSON.stringify({
      workflowRunId: body.workflowRunId,
      workflowAttempt: body.workflowAttempt,
      mode,
      result: "PASS",
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runProbes({ mode: process.argv[2], environment: process.env });
  } catch {
    console.error(
      "Hosted OIDC rejection probes failed. No credential or response body was logged.",
    );
    process.exitCode = 1;
  }
}
