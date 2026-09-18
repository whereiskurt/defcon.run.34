# DC34 teardown playbook

Destroy order and the traps found on 2026-09-13 by reading the Terragrunt tree
and the live account. Read the whole thing before the first `destroy`.

## 0. Gate: the snapshot is verified

- [x] `scripts/dc34-backup/snapshot.sh` ran (2026-09-13, run `20260913T220136Z`); `s3://defcon.run.34.backup/LATEST` points at a run whose
      `MANIFEST.json` shows every table `COMPLETED` with sane item counts and every source bucket synced.
- [x] `restore_local.py run-human-electro` loads cleanly (3565/3565, 4 GSIs) — proves the export is readable, not just present.
- [ ] Both open PRs merged, `main` clean, no worktree holds uncommitted infra changes.

## 1. Do-not-touch list (same AWS account, not part of this destroy)

| Thing | Why |
|---|---|
| `s3://defcon.run.34.backup`, `s3://defcon.run.33.backup` | the backups |
| `dc35-*` buckets, `tf-dc35-*` state | next year's stacks live in this account |
| `tf-dc34-{use1,cac1,apse1}-80a6b349` buckets + DDB lock tables | Terragrunt state — needed *during* the destroy; delete by hand at the very end if at all |
| `User` DDB table | 2024 relic, deletion-protected, not in state |
| KMS `alias/sops` | decrypts the SSM backup |
| `defcon.run` apex hosted zone (mgmt account) | only the `*.defcon.run` sub-zones are TF-managed here |
| `www.defcon.run.20240523`, `meshtk-blocklist-20250101` | not in state |

Never run anything account-wide (`aws s3 rb` loops, `aws dynamodb delete-table` loops). Only `terragrunt destroy` inside `infra/terraform/live/site`.

## 2. Known blockers, in the order you will hit them

1. ✅ **DONE 2026-09-13** — `state rm`'d `app["auth"|"gpx"|"human"]`; `terragrunt plan -destroy` on the unit is
   clean (`0 to add, 0 to change, 25 to destroy`, no re-import). Kept for the record:
   **`admin-reports` — `prevent_destroy = true`** on the adopted `/ecs/*` log groups
   (`modules/admin-reports/v1.0.0/retention.tf`). `destroy` hard-fails here. Before destroying that unit:
   ```bash
   cd infra/terraform/live/site/region/us-east-1/admin-reports
   terragrunt state list | grep aws_cloudwatch_log_group.app   # then for each:
   terragrunt state rm 'aws_cloudwatch_log_group.app["<key>"]'
   ```
   The log groups then simply outlive the stack (90-day retention self-cleans). Or delete the
   `lifecycle` block in a commit first — either works; `state rm` avoids a PR.
2. **`abuse-detection` must be destroyed while `enabled = true`** (`site.hcl` ~L516). Flipping to
   `false` first *excludes* the unit and orphans the Lambda/Athena/EventBridge resources.
3. **DNS goes dark.** `modules/site` owns the `email./run./auth./cms./gpx./flash./mqtt./bib.defcon.run`
   hosted zones plus the NS delegations in the mgmt-account apex. That is the intended end state, but it is
   the point of no return for the URLs — do it last.
4. **CloudFront** — 6 distributions, each ~15 min to disable + delete. Not a failure, just wall clock.
   Budget an hour.
5. **ACM certs** are `create_before_destroy` and still attached until CF is gone — destroy waits on #4.
6. **SES receipt rule set** — the active rule set can't be deleted while active. The email module handles
   it in-graph; if it errors, `aws ses set-active-receipt-rule-set` (no argument) then retry.
7. Fine as-is: ECR `force_delete = true` (immutable images don't block), every log/uploads/status bucket is
   `force_destroy = true` (versions included), DDB tables have no deletion protection, cac1 carries
   nothing live.

## 3. Order

```bash
cd infra/terraform/live/site
terragrunt plan --all -destroy 2>&1 | tee ~/dc34-destroy-plan.txt   # read it; count resources
# 1. fix blocker #1 (state rm), confirm blocker #2 config
# 2. services first (ECS, ALB targets), then regional (dynamodb, uploads, cloudfront, email, mqtt…),
#    then global (site: zones + certs). Terragrunt's dependency graph does this ordering for you:
terragrunt destroy --all
# 3. re-plan; a clean plan = nothing left in state
terragrunt plan --all -destroy
```

Run it from a machine with `env.local.sh` present. Local terragrunt needs **three** things or it fails
confusingly: `export SGUID=80a6b349; source env.sh` (sets `TG_BUCKET_USE1`/`TG_TABLE_USE1`), `source env.local.sh`,
and `export AWS_PROFILE=dc34-application` (sops decrypt in `site.hcl`; the backend uses `dc34-terraform` itself).
If a dependency's `.terragrunt-cache` is stale ("Backend initialization required"), add
`--dependency-fetch-output-from-state` to read outputs from S3 instead — the same
worktree landmine as releases. This is the one time a local apply is the right tool: there is
no CI workflow for destroy and there shouldn't be.

## 4. After

- [ ] Sweep the account for stragglers: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Site,Values=dc34`
      (ECS-auto-created log groups, the `state rm`'d ones, orphaned ENIs, Lambda log groups).
- [ ] Decide on `tf-dc34-*` state buckets/lock tables. Keeping them is cheap; state is a useful audit trail.
- [ ] Route53 apex: confirm the stale NS delegation records for the sub-zones are gone (they are TF-managed
      and should be, but check — dangling NS = subdomain takeover surface).
- [ ] SES: the `defcon.run` domain identity, if not TF-managed, still exists — fine, harmless.
- [ ] Cost Explorer a week later: anything still billing under `Site=dc34`?
