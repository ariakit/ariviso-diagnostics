# Ariviso diagnostics fixture

This repository contains only synthetic text and one GitHub Actions check. It is used to inspect pull request and merge-queue metadata in an isolated repository.

The `fixture` check runs for pull requests that target `main` and for merge groups. A merge-group run waits 180 seconds so the associated commit and pull request metadata can be inspected while the group exists.

The workflow does not check out repository content, install dependencies, upload artifacts, or use secrets. Its only permission is read access to repository contents.

Create two independent pull requests with small text changes to exercise the queue. Keep application code, screenshots, and private data out of this repository.

## Ariviso end-to-end diagnostics

This public repository contains synthetic colored cards, public client packages, and runner metadata. It contains no private application source, capture archive, service credentials, or production images. The service keeps manifests and image uploads private. GitHub receives only the small synthetic discovery receipt and the runner profile probe.

The capture uses two fixed Chromium shards. Each shard must capture its entire assigned test collection. The workflow binds the uploaded manifest to a successful job through its receipt artifact name. The server verifies the OIDC token, exact job, attempt, tested SHA, trusted plan, complete inventory, and independent artifact metadata.

### Bootstrap

Keep `ARIVISO_DIAGNOSTIC_ENABLED` unset until these steps finish. The existing `fixture` check remains in place.

1. Commit **A** contains the reviewed harness, the two reviewed tarball SHA-256 values in `.github/ariviso/settings.json`, and the manual profile probe. Set the repository secrets `ARIVISO_PLAYWRIGHT_TARBALL_URL` and `ARIVISO_CLI_TARBALL_URL` to direct, expiring R2 GET URLs. The installer checks their exact bytes before installation and does not print their URLs.
2. Run `ariviso-probe.yml` on main. Download both environment JSON artifacts. This probe uses no service identity token and uploads no screenshot.
3. Run `node .github/ariviso/pin.mjs source <A>` and commit **B**. Its reusable workflow checks out only the executable harness from immutable commit A.
4. Run `node .github/ariviso/configure.mjs <environment-chromium-1.json> <environment-chromium-2.json>`. It writes `.github/ariviso-plan.json` and prints the plan and executor digests. Run `node .github/ariviso/pin.mjs workflow <B>` and commit **C** with the plan and generated caller workflow. The caller template is outside `.github/workflows` until its immutable pin exists.
5. Configure the diagnostic service for repository ID `1380792062`, owner ID `40200111`, caller `.github/workflows/ariviso-diagnostic.yml`, reusable workflow `ariakit/ariviso-diagnostics/.github/workflows/ariviso-capture.yml@<B>`, reusable SHA B, the printed executor digest, and trusted plan path `.github/ariviso-plan.json`. The OIDC audience is `https://ariviso-diagnostics.ariakit.workers.dev`. Enable main workflow dispatch only for this diagnostic environment.
6. Enable the signed GitHub App webhook and set `ARIVISO_DIAGNOSTIC_ENABLED=true`. Run a main capture, then same-repository PR and merge-queue captures. The exact job names are `capture / chromium-1` and `capture / chromium-2`.

The capture job does not check out the candidate repository. A fixed helper fetches only `scenario.json` at the actual tested SHA, limits the response and file size, and writes a sanitized object with exactly the three supported fields. Candidate package manifests, npm workspaces, TypeScript configuration, import aliases, and other source files never enter the capture workspace.

The immutable harness loads only a JSON plan from a resolved main commit. It verifies the complete fixed collection and executor digest before using the measured environment allowlist. It does not execute configuration from the candidate branch or the main plan.

### Controlled cases

Change only `scenario.json` for these cases. The fixed harness accepts `blue`, `green`, or `red` as the synthetic color.

- Set `failSecondShardOnFirstAttempt` to `true` to fail shard 2 throughout workflow attempt 1. Shard 1 still uploads and completes. Use **Re-run failed jobs** without changing the tested commit or trusted plan. Attempt 2 must inherit only the verified successful shard 1 and upload a new successful shard 2.
- Set `retrySecondTestOnce` to `true` to capture red and fail the first Playwright attempt for the second card. The retry captures the chosen scenario color. Only the final successful capture can enter the sealed run.
- Change `color` to create an exact, intentional visual difference. Review and rejection happen through the private service. Check that later check delivery reflects the current decision after capture jobs have ended.
- For a plan-completeness negative case, mutate only a disposable candidate workflow invocation or omit an expected upload. The trusted executor or service must reject it. Restore the fixed caller before the positive cases.

Do not add image-bearing Playwright traces, reports, manifests, or diagnostic archives to public GitHub artifacts. The service and private export path provide that evidence. All queue-policy changes and required-check cutovers are separate operator actions.

The bootstrap uses [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) with explicit secrets and immutable commit references. Follow the [GitHub job rerun procedure](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) for the failed-job case.

### Hosted OIDC rejection probes

The manual `ariviso-oidc-negative.yml` workflow sends bounded requests to the diagnostic service. Its no-token job has no OIDC permission and must receive `401 credential_required`. Its other job requests real GitHub tokens in memory: a wrong audience must receive `401 invalid_oidc`, and a direct workflow outside the trusted reusable executor must receive `403 untrusted_run`.

The untrusted job also tries a different repository identity and the trusted workflow's commit as its claimed tested SHA. These requests must remain rejected. They test the untrusted-workflow boundary; they do not independently exercise claim checks that occur after that boundary. No token, response body, capability, screenshot, or manifest is written to a file, artifact, or log. Output contains only fixed case labels, expected status/error codes, and the public workflow run ID and attempt. Local helper tests run on changes to the probe files.

After a hosted run, the operator must verify that the private diagnostic database contains no run with the printed external workflow ID. This is a separate private check because the probe has no read capability. For example, run `SELECT count(*) FROM ariviso_runs WHERE external_run_id = '<printed workflow ID>';` through the authorized D1 operator path and require zero. Do not grant the public workflow database access. Keep this workflow separate from the required visual check, and do not dispatch it after the diagnostic service is retired at production cutover.
