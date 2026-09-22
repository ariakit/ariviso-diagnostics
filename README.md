# Ariviso diagnostics fixture

This repository contains only synthetic text and one GitHub Actions check. It is used to inspect pull request and merge-queue metadata in an isolated repository.

The `fixture` check runs for pull requests that target `main` and for merge groups. A merge-group run waits 180 seconds so the associated commit and pull request metadata can be inspected while the group exists.

The workflow does not check out repository content, install dependencies, upload artifacts, or use secrets. Its only permission is read access to repository contents.

Create two independent pull requests with small text changes to exercise the queue. Keep application code, screenshots, and private data out of this repository.
