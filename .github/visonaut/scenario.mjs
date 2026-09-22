import { writeFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./identity.mjs";

export function sanitizeScenario(value) {
  const keys = ["color", "failSecondShardOnFirstAttempt", "retrySecondTestOnce"];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    !["blue", "green", "red"].includes(value.color) ||
    typeof value.failSecondShardOnFirstAttempt !== "boolean" ||
    typeof value.retrySecondTestOnce !== "boolean"
  ) {
    throw new Error("The candidate scenario must contain only the three fixed synthetic fields");
  }
  return {
    color: value.color,
    failSecondShardOnFirstAttempt: value.failSecondShardOnFirstAttempt,
    retrySecondTestOnce: value.retrySecondTestOnce,
  };
}

export async function fetchScenario({ repository, testedSha, token, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(testedSha)) {
    throw new Error("A fixed repository and full tested SHA are required for the scenario");
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/contents/scenario.json?ref=${testedSha}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`The tested synthetic scenario is unavailable (${response.status})`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) throw new Error("The scenario response exceeds its byte limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const file = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (
    file.type !== "file" ||
    file.path !== "scenario.json" ||
    file.encoding !== "base64" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 1024 ||
    typeof file.content !== "string"
  ) {
    throw new Error("The scenario must be a small regular JSON file");
  }
  const encoded = file.content.replace(/\n/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== file.size || bytes.toString("base64") !== encoded) {
    throw new Error("The scenario file encoding is invalid");
  }
  return sanitizeScenario(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

export async function writeScenario(options, directory = repositoryRoot) {
  const scenario = await fetchScenario(options);
  await writeFile(path.join(directory, "scenario.json"), `${JSON.stringify(scenario)}\n`);
}
