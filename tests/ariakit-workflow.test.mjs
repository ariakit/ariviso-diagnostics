import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/visonaut-ariakit.yml", import.meta.url),
  "utf8",
);

function job(name, next) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = next ? workflow.indexOf(`  ${next}:\n`, start + 1) : workflow.length;
  assert.ok(start >= 0 && end > start, `Missing ${name} job`);
  return workflow.slice(start, end);
}

function rows(source) {
  // Read the fixed include rows without adding a YAML dependency to the fixture.
  const matrix = source.match(/    strategy:\n[\s\S]*?    steps:/)?.[0];
  assert.ok(matrix, "Missing fixed matrix");
  return [...matrix.matchAll(/^          - os: ([^\n]+)\n([\s\S]*?)(?=^          - os: |^    steps:)/gm)].map(
    ([, os, fields]) => ({
      os,
      ...Object.fromEntries(
        [...fields.matchAll(/^            (\w+): (.+)$/gm)].map(([, key, value]) => [
          key,
          value.replace(/^'|'$/g, ""),
        ]),
      ),
    }),
  );
}

const renderJobs = [
  job("render_chrome", "render_firefox"),
  job("render_firefox", "render_safari"),
  job("render_safari", "upload_chrome"),
];
const uploadJobs = [
  job("upload_chrome", "upload_firefox"),
  job("upload_firefox", "upload_safari"),
  job("upload_safari", "submit"),
];
const render = renderJobs[0];
const upload = uploadJobs[0];
const submit = job("submit");

test("the public caller cannot choose a smaller capture plan", () => {
  const call = workflow.slice(workflow.indexOf("  workflow_call:\n"), workflow.indexOf("permissions:\n"));
  assert.doesNotMatch(call, /\binputs:/);
  assert.match(call, /VISONAUT_PLAYWRIGHT_TARBALL_URL:\n        required: true/);
  assert.match(call, /VISONAUT_CLI_TARBALL_URL:\n        required: true/);

  const selected = renderJobs.flatMap(rows);
  assert.deepEqual(
    selected.map(({ os, shard, project, browser, device, retries }) => ({
      os,
      shard,
      project,
      browser,
      device,
      retries,
    })),
    [
      { os: "ubuntu-24.04", shard: "chrome", project: "chrome", browser: "chromium", device: "Desktop Chrome", retries: "1" },
      { os: "ubuntu-24.04", shard: "firefox", project: "firefox", browser: "firefox", device: "Desktop Firefox", retries: "2" },
      { os: "macos-latest", shard: "safari", project: "safari", browser: "webkit", device: "Desktop Safari", retries: "3" },
    ],
  );
  assert.deepEqual(
    uploadJobs.flatMap(rows).map(({ os, shard, browser }) => ({ os, shard, browser })),
    selected.map(({ os, shard, browser }) => ({ os, shard, browser })),
  );

  for (const { shard, patterns } of selected) {
    const matches = JSON.parse(patterns).map((source) => new RegExp(source));
    const selectedFile = `app/src/sandbox/item/test-${shard}.ts`;
    assert.ok(matches.some((pattern) => pattern.test(selectedFile)));
    assert.ok(matches.some((pattern) => pattern.test("app/src/tests/previews-browser.ts")));
    assert.equal(matches.some((pattern) => pattern.test("app/src/sandbox/item/test-chrome-firefox.ts")), shard !== "safari");
    assert.ok(matches.every((pattern) => !pattern.test("app/src/sandbox/item/test-mobile.ts")));
    assert.ok(matches.every((pattern) => !pattern.test("app/src/sandbox/item/perf-chrome.ts")));
  }
  assert.match(render, /--test-dir app\/src/);
  assert.match(render, /VISONAUT_TEST_PATTERNS: \$\{\{ matrix\.patterns \}\}/);
  assert.match(render, /--test-patterns "\$VISONAUT_TEST_PATTERNS"/);
  const preview = JSON.parse(render.match(/VISONAUT_WEB_SERVERS: >-\n            ([^\n]+)/)?.[1]);
  assert.deepEqual(
    preview.map(({ command, cwd, url }) => ({ command, cwd, url })),
    [
      { command: "pnpm run preview --port 4321", cwd: "app", url: "http://127.0.0.1:4321" },
      { command: "pnpm -F nextjs exec opennextjs-cloudflare preview --port 3000 --inspector-port 9340", cwd: ".", url: "http://127.0.0.1:3000" },
    ],
  );
});

test("render keeps candidate code separate from signed upload", () => {
  for (const [index, shard] of ["chrome", "firefox", "safari"].entries()) {
    assert.match(renderJobs[index], /needs: \[build_app, build_nextjs\]/);
    assert.match(renderJobs[index], /permissions:\n      contents: read/);
    assert.doesNotMatch(renderJobs[index], /id-token: write/);
    assert.match(uploadJobs[index], new RegExp(`needs: render_${shard}`));
    assert.match(uploadJobs[index], /permissions:\n      actions: read\n      id-token: write/);
    assert.doesNotMatch(uploadJobs[index], /actions\/checkout@|\.\/\.github\/workflows\/setup/);
  }
  assert.match(renderJobs[1], /steps: \*render_steps/);
  assert.match(renderJobs[2], /steps: \*render_steps/);
  assert.match(uploadJobs[1], /steps: \*upload_steps/);
  assert.match(uploadJobs[2], /steps: \*upload_steps/);
  assert.match(render, /actions\/checkout@/);
  assert.ok(render.indexOf("&install_package") < render.indexOf("actions/checkout@"));
  assert.match(render, /--font-package @fontsource-variable\/inter/);
  assert.match(render, /--output "\$RUNNER_TEMP\/visonaut-\$VISONAUT_SHARD\.enc"/);
  assert.match(render, /retention-days: 70/);

  assert.match(upload, /--font-package @fontsource-variable\/inter/);
  assert.match(upload, /--input "\$RUNNER_TEMP\/visonaut-transfer\/visonaut-\$VISONAUT_SHARD\.enc"/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/visonaut-submission-\$\{\{ matrix\.shard \}\}\/receipt\.json/);

  assert.match(submit, /needs: \[upload_chrome, upload_firefox, upload_safari\]/);
  assert.match(submit, /id-token: write/);
  assert.doesNotMatch(submit, /always\(\)|actions\/checkout@/);
  assert.match(submit, /submit --run "\$GITHUB_RUN_ID"/);
});

test("the verified adapter and one Playwright runtime reach Ariakit tests", () => {
  assert.match(workflow, /VISONAUT_PACKAGE_SHA256: 7be6fe091e8b95db733abc118e3dacc9d6d36575c5685c590e0cea9155494b72/);
  assert.match(workflow, /VISONAUT_CLI_SHA256: 5d4cc8cbe135ce04aebbd793879a9f1afd53282cc58a6f8cbadf7236c65970e4/);
  assert.match(render, /shasum -a 256 "\$archive"/);
  assert.match(render, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(render, /for workspace in app packages\/ariakit-test packages\/ariakit-scripts/);
  assert.match(render, /ln -s "\$package\/ci\/node_modules\/@playwright\/test" "\$module"/);
  assert.match(render, /module=app\/node_modules\/@visonaut\/playwright/);
  assert.match(render, /ln -s "\$package" "\$module"/);
});
