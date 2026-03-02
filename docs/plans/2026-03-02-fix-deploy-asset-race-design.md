# Fix Deploy Asset Race Conditions

**Date:** 2026-03-02
**Status:** Approved

## Problem

When `buildpub.yml` runs with `deploy=true`, two race conditions cause broken deployments:

1. **S3 `--delete` removes old assets before ECS rollover completes.** The build syncs new static assets to S3 with `--delete`, removing old content-hashed chunks. The old ECS task still serves HTML referencing those deleted chunks, causing `ChunkLoadError` and a page reload loop.

2. **Deploy job reads stale VERSION files.** The deploy jobs (`deploy-use1`, etc.) call `terragrunt-apply.yml` which checks out the repo at the workflow's start commit — before the build job merges the release PR. Terraform reads pre-merge VERSION files and deploys the wrong image version.

## Fix 1: Remove `--delete` from S3 sync

**File:** `apps/build.sh`

Remove `--delete` from both `aws s3 sync` commands (lines 184 and 202). Content-hashed filenames never collide between versions, so old and new assets coexist safely. S3 lifecycle rules can handle cleanup separately.

## Fix 2: Pass merge SHA to deploy checkout

**Files:** `.github/workflows/buildpub.yml`, `.github/workflows/terragrunt-apply.yml`

### Changes to `terragrunt-apply.yml`

Add optional `ref` input to `workflow_call`:

```yaml
workflow_call:
  inputs:
    ref:
      description: 'Git ref to checkout (default: workflow trigger ref)'
      type: string
      default: ''
```

Use it in the checkout step:

```yaml
- name: Checkout
  uses: actions/checkout@v4
  with:
    ref: ${{ inputs.ref || '' }}
```

### Changes to `buildpub.yml`

1. In each build job's "Merge PR" step, capture the merge SHA as a step output (`merge_sha`).
2. Surface `merge_sha` as a job output from each build job.
3. In deploy jobs, pass the SHA to `terragrunt-apply.yml`:

```yaml
deploy-use1:
  uses: ./.github/workflows/terragrunt-apply.yml
  with:
    ref: ${{ needs.build-github-hosted.outputs.merge_sha || needs.build-ec2-new.outputs.merge_sha || needs.build-ec2-existing.outputs.merge_sha || '' }}
```

### Edge cases

- No PR created (`create_pr=false`): no SHA produced, deploy uses default ref (correct — no merge race)
- Merge fails: no SHA produced, same fallback
- `deploy.yml` (standalone workflow): not affected, has its own merge-first logic
