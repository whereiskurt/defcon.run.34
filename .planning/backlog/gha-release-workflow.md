---
title: release.yml — move app release builds from laptop to GitHub Actions
captured: 2026-07-24
source: run.flash multi-firmware session with Kurt ("more offline while the 2GBs ship")
status: backlog — good post-UAT follow-up, prerequisite-free
milestone: TBD
depends_on: nothing hard; crib auth pattern from deploy.yml OIDC + run.mqtt buildpub.yml
fast_follow: candidate — mostly auth plumbing, scripts already do the work
number: TBD — sweep worktrees before minting (see project_phase_number_collisions)
---

# release.yml — GitHub-hosted release builds

## Why we want it

`release-all.sh` currently runs on Kurt's laptop: it downloads ~2GB of Meshtastic
firmware/APKs from upstream, cross-builds the amd64 image via buildx emulation on
Apple Silicon, pushes ~2GB of layers to ECR, syncs ~300MB static assets to S3, and
opens the Release PR — all over residential/conference uplink. Only the deploy
(deploy.yml) is in CI today.

A `release.yml` (workflow_dispatch, `-f apps=run.flash`) moves the whole build to
GitHub-hosted runners:

- Firmware/APK downloads come from GitHub releases + raw.githubusercontent —
  same-datacenter inside Actions, seconds instead of minutes.
- amd64 runners build the image natively (no buildx emulation — likely the
  single biggest speedup vs the laptop).
- Releases become triggerable from the GitHub phone app; laptop can be offline.
- The `env.local.sh` worktree landmine disappears in CI (OIDC role replaces the
  local `dc34-application` profile entirely).

## Shape of the work

1. Extend the existing github-oidc CI role: ECR push (`dc34-run-*` repos) +
   S3 write on the `cf-assets-*` buckets. (Recall: `scheduler:*` was once
   missing from this role — expect one-permission-at-a-time discovery.)
2. CI mode for `build.sh`/`release-all.sh`: skip the `env.local.sh` profile
   resolution when `CI=true` / `AWS_PROFILE` unset — use ambient OIDC creds.
   The `aws_cmd` helper hard-sets the profile today; that's the main edit.
3. `release.yml`: checkout main, run `release-all.sh --apps <apps> --pr`,
   `concurrency:` group per app so parallel runs can't race the immutable ECR
   tags. Runner disk check (~14GB free on hosted runners; 3-version firmware
   bake + layers fits but verify).
4. Flow stays: release.yml opens the Release PR → deploy.yml (unchanged)
   merges + applies + invalidates.

## Acceptance

- `gh workflow run release.yml -f apps=run.flash` from a machine with zero AWS
  config produces a Release PR with both images in ECR and assets in S3.
- Laptop release path still works (CI mode is additive, not a replacement).
