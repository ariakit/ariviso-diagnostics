# Visonaut diagnostics fixture

This public repository contains synthetic text, a fixed capture harness, and GitHub Actions checks. It is used to inspect pull request and merge-queue metadata in an isolated repository.

The `fixture` check runs for pull requests that target `main` and for merge groups. A merge-group run waits 180 seconds so the associated commit and pull request metadata can be inspected while the group exists. The `fixture` workflow does not check out repository content, install dependencies, upload artifacts, or use secrets.

Create two independent pull requests with small text changes to exercise the queue. Keep application code, screenshots, credentials, and private review data out of this repository.

## Signed Visonaut capture

The capture workflow runs two fixed Chromium shards against synthetic colored cards. Each render job checks out only the harness at the pinned `VISONAUT_EXECUTOR_SOURCE` commit, then fetches only `scenario.json` at the tested commit. It has no GitHub identity-token permission. The reviewed Visonaut package selects the complete test collection, measures the actual environment, and writes an encrypted transfer artifact. Candidate package files and test selection settings do not enter the capture workspace.

Each separate upload job has `id-token: write` and does not check out candidate code. It downloads a checksum-verified client package and its shard's encrypted transfer, installs matching browser dependencies, and checks the captured OS, fonts, and comparison policy against its own environment before staging the signed bundle. GitHub receives an encrypted transfer and a small discovery receipt, never a plaintext screenshot, manifest, or image-bearing trace. The final job runs only after both upload jobs succeed and calls `visonaut submit --run "$GITHUB_RUN_ID"`. The service must still verify the whole GitHub workflow before its App check can pass.

### Bootstrap

Keep `VISONAUT_DIAGNOSTIC_ENABLED` unset until the signed path is configured. The independent `fixture` check stays in place.

1. Set repository secrets `VISONAUT_PLAYWRIGHT_TARBALL_URL` and `VISONAUT_CLI_TARBALL_URL` to direct, expiring private-bucket GET URLs for the reviewed client archives. The workflow checks each archive's exact SHA-256 before use and does not print the URLs.
2. Merge the reviewed reusable capture workflow. In a separate caller change, pin `.github/workflows/visonaut-diagnostic.yml` to that full merge commit SHA. The workflow does not support manual image capture. `visonaut-probe.yml` remains available for a manual, no-OIDC environment probe.
3. Configure the diagnostics service for repository ID `1380792062`, owner ID `40200111`, caller `.github/workflows/visonaut-diagnostic.yml`, and the exact pinned reusable workflow ref and SHA. Set `VISONAUT_WORKFLOW_OWNED` with the observed capture-job prefix and submit-job name. Keep the OIDC audience at `https://diagnostics.visonaut.com`. The signed path derives the complete job set from GitHub rather than a trusted-plan file or a profile-digest allowlist.
4. Enable the signed GitHub App webhook and set `VISONAUT_DIAGNOSTIC_ENABLED=true`. Run one bounded main capture, then same-repository PR and merge-queue captures. Verify the exact job names, every staged bundle, the final submit, and the App check before using the workflow for Ariakit.

### Controlled cases

Change only `scenario.json` for these cases. The fixed harness accepts `blue`, `green`, or `red` as the synthetic color.

- Set `failSecondShardOnFirstAttempt` to `true` to fail shard 2 throughout workflow attempt 1. Shard 1 still uploads and completes. Use **Re-run failed jobs** without changing the tested commit or workflow pin. Attempt 2 must inherit only the verified successful shard 1 and upload a new successful shard 2.
- Set `retrySecondTestOnce` to `true` to capture red and fail the first Playwright attempt for the second card. The retry captures the chosen scenario color. Only the final successful capture can enter the sealed run.
- Change `color` to create an exact, intentional visual difference. Review and rejection happen through the private service. Confirm that later check delivery reflects the current decision after capture jobs have ended.
- For a completeness refusal, fail or omit one signed upload in a disposable diagnostic workflow run. The service must leave the App check unsuccessful and must not interpret that absence as a removed visual item.

A successful render's encrypted artifact stays available for delayed failed-job reruns. A rerun upload checks the current signed job and attempt, then uses the original tested run and commit only if they still match. The service inherits only verified successful jobs that GitHub did not rerun.

Do not add image-bearing Playwright traces, reports, manifests, or diagnostic archives to public GitHub artifacts. The service and private export path provide that evidence. Queue-policy changes and required-check cutovers are separate operator actions.

The bootstrap uses [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) with explicit secrets and immutable commit references. Follow the [GitHub job rerun procedure](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) for the failed-job case.

### Hosted OIDC rejection probes

The manual `ariviso-oidc-negative.yml` workflow sends bounded requests to the diagnostic service. Its no-token job has no OIDC permission and must receive `401 credential_required`. Its other job requests real GitHub tokens in memory: a wrong audience must receive `401 invalid_oidc`, and a direct workflow outside the trusted reusable executor must receive `403 untrusted_run`.

The untrusted job also tries a different repository identity and the trusted workflow's commit as its claimed tested SHA. These requests must remain rejected. They test the untrusted-workflow boundary; they do not independently exercise claim checks that occur after that boundary. No token, response body, capability, screenshot, or manifest is written to a file, artifact, or log. Output contains only fixed case labels, expected status/error codes, and the public workflow run ID and attempt. Local helper tests run on changes to the probe files.

After a hosted run, the operator must verify that the private diagnostic database contains no run with the printed external workflow ID. This is a separate private check because the probe has no read capability. For example, run `SELECT count(*) FROM ariviso_runs WHERE external_run_id = '<printed workflow ID>';` through the authorized D1 operator path and require zero. Do not grant the public workflow database access. Keep this workflow separate from the required visual check, and do not dispatch it after the diagnostic service is retired at production cutover.
