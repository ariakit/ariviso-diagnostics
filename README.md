# Visonaut diagnostics fixture

This public repository contains synthetic text, a fixed capture harness, and GitHub Actions checks. It is used to inspect pull request and merge-queue metadata in an isolated repository.

The `fixture` check runs for pull requests that target `main` and for merge groups. A merge-group run waits 180 seconds so the associated commit and pull request metadata can be inspected while the group exists.

The `fixture` workflow does not check out repository content, install dependencies, upload artifacts, or use secrets. Its only permission is read access to repository contents. The capture workflow uses the separate, pinned harness and short-lived package download URLs described below.

Create two independent pull requests with small text changes to exercise the queue. Keep application code, screenshots, and private data out of this repository.

## Visonaut end-to-end diagnostics

The capture harness uses synthetic colored cards and reviewed client-package tarballs. This repository contains no private application source, capture archive, service credentials, or production images. The service keeps manifests and image uploads private. GitHub receives only the small synthetic discovery receipt and measured runner profiles.

The capture uses two fixed Chromium shards. Each shard must capture its entire assigned test collection. Each job uploads its measured runner profile before capture validation so an unregistered image can be inspected without accepting its pixels. The workflow binds the uploaded manifest to a successful job through its separate receipt artifact name. The server verifies the OIDC token, exact job, attempt, tested SHA, trusted plan, complete inventory, and independent artifact metadata.

### Bootstrap

Keep `VISONAUT_DIAGNOSTIC_ENABLED` unset until these steps finish. The existing `fixture` check remains in place.

1. Commit **A** contains the reviewed harness, the two reviewed tarball SHA-256 values in `.github/visonaut/settings.json`, and the manual profile probe. Set the repository secrets `VISONAUT_PLAYWRIGHT_TARBALL_URL` and `VISONAUT_CLI_TARBALL_URL` to direct, expiring R2 GET URLs. The installer checks their exact bytes before installation and does not print their URLs.
2. Run `visonaut-probe.yml` on main. Download both environment JSON artifacts. This probe uses no service identity token and uploads no screenshot.
3. Run `node .github/visonaut/pin.mjs source <A>` and commit **B**. Its reusable workflow checks out only the executable harness from immutable commit A.
4. Run `node .github/visonaut/configure.mjs <environment-chromium-1.json> <environment-chromium-2.json>`. It writes `.github/visonaut-plan.json` and prints the plan and executor digests. Run `node .github/visonaut/pin.mjs workflow <B>` and commit **C** with the plan and generated caller workflow. The caller template is outside `.github/workflows` until its immutable pin exists.
5. Configure the diagnostic service for repository ID `1380792062`, owner ID `40200111`, caller `.github/workflows/visonaut-diagnostic.yml`, reusable workflow `ariakit/visonaut-diagnostics/.github/workflows/visonaut-capture.yml@<B>`, reusable SHA B, the printed executor digest, and trusted plan path `.github/visonaut-plan.json`. The OIDC audience is `https://diagnostics.visonaut.com`. Enable main workflow dispatch only for this diagnostic environment.
6. Enable the signed GitHub App webhook and set `VISONAUT_DIAGNOSTIC_ENABLED=true`. Run a main capture, then same-repository PR and merge-queue captures. The exact job names are `capture / chromium-1` and `capture / chromium-2`.

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
