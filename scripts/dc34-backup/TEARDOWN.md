# DC34 teardown playbook

Destroy order and the traps found by reading the Terragrunt tree and the live
account (2026-09-13), plus the toolchain traps found while producing a clean
destroy plan (2026-10-25). Read the whole thing before the first `destroy`.

**Verified plan, 2026-10-25:** `terragrunt plan --all -destroy` exits 0 with
**0 errors, 892 resources to destroy across 25 units** (us-east-1 + global;
`ca-central-1`/`ap-southeast-1` are excluded by `skip_regions` and hold no state).
Saved at `~/dc34-destroy-plan.txt`.

## 0. Gate: the snapshot is verified

- [x] `scripts/dc34-backup/snapshot.sh` ran **2026-10-25**, run `20261025T213115Z`;
      `s3://defcon.run.34.backup/LATEST` points at it. Every table `COMPLETED` and every
      `exportedItems` matches `describeTableItemCount` exactly.
- [x] `restore_local.py run-gpx-electro` → **1807/1807** items into local DynamoDB, all 3 GSIs
      populated — proves the export is readable, not just present.
- [x] SSM dump round-tripped: `ssm/20261025T213115Z.secrets.sops.json` pulled back and
      `sops --decrypt` returned 193 parameters (proves the KMS path, not just the file).
- [x] `main` clean, no open PRs, no worktree holds uncommitted infra changes.

**If the destroy slips by more than a week or two, re-run `snapshot.sh`.** The
2026-09-13 snapshot was 6 weeks stale by the time it was checked and was missing
~840 DynamoDB items and 605 GPX files. It is idempotent and only syncs deltas.

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

**Verified against the 2026-10-25 plan:** zero references to either backup bucket,
zero to `dc35-*`, zero to `alias/sops`, zero to the `User` table. The six
`tf-dc34-use1|cac1` hits are IAM policy ARN *patterns* inside `global/github-oidc`
(`arn:aws:s3:::tf-dc34-use1-*`) — the grants being deleted, not the buckets.

Never run anything account-wide (`aws s3 rb` loops, `aws dynamodb delete-table` loops).
Only `terragrunt destroy` inside `infra/terraform/live/site`.

## 2. Shell setup — three things, or it fails confusingly

```bash
cd <repo root>
export SGUID=80a6b349          # MUST come first — see the landmine below
source env.sh                  # sets TG_BUCKET_USE1 / TG_TABLE_USE1 from SGUID
source env.local.sh            # TF_VAR_profile_prefix=dc34 (gitignored; copy into worktrees)
export AWS_PROFILE=dc34-application   # sops decrypt in site.hcl; the backend itself uses dc34-terraform

# verify before anything else
echo "$TG_BUCKET_USE1"         # MUST print tf-dc34-use1-80a6b349
aws s3 ls "s3://$TG_BUCKET_USE1" --region us-east-1 >/dev/null && echo "state bucket OK"
```

**`env.sh` landmine:** line 3 is
`export GUID=${GUID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}` and line 4 derives
`SGUID` from it. Source `env.sh` *without* presetting `SGUID` and it invents a random
one, so the backend becomes `tf-dc34-use1-<random8>` — a bucket that does not exist.
Terraform reports this as `Backend configuration block has changed`, which points
nowhere near the cause.

SSO expires every few hours. Re-login before starting, not mid-destroy.

## 3. Toolchain traps (cost ~40 min on 2026-10-25; all pre-cleared now)

1. **Stale `.terragrunt-cache`.** Caches dating to 2026-05-07 were written under an
   older Terraform S3-backend schema. Every *value* matched the freshly generated
   backend block (bucket, key, region, `dynamodb_table`, `encrypt`, `profile`), but the
   schema *hash* differed, so Terraform reported
   `Backend initialization required ... Backend configuration block has changed`.
   Fix — caches are pure derived artifacts, the S3 state is untouched:
   ```bash
   cd infra/terraform/live/site
   find . -type d -name '.terragrunt-cache' -prune -exec /bin/rm -rf {} +
   ```
2. **Per-unit `.terraform.lock.hcl` drift.** 73 lockfiles on disk pinning *different* aws
   provider versions (6.20.0, 6.21.0, 6.22.1, 6.27.0, 6.53.0, 6.64.0) — months of local
   per-unit runs. CI inits fresh and gets the newest, so **state was written by a newer
   provider than the local locks allowed**, producing 24×
   `Error: Resource instance managed by newer provider version`. Only **1** of the 73 is
   git-tracked (`region/us-east-1/status-site`, pins 6.53.0), so the rest are safe to delete:
   ```bash
   find infra/terraform/live/site -name '.terraform.lock.hcl' -not -path '*cache*' \
     -not -path '*/status-site/*' -delete
   terragrunt init --all -upgrade --dependency-fetch-output-from-state
   ```
   All 27 units then resolve **aws 6.70.0**, 0 errors.
3. **`There is no variable named "dependency"` is always a cascade, never a real bug.**
   When Terragrunt cannot resolve a dependency's outputs it drops the `dependency` block,
   and the `inputs` reference then fails to parse. It appeared on `status-site`,
   `redirect-rules`, `abuse-detection`, `bib-reconcile`, both `s3-uploads-*` and both
   schedulers — all downstream of a unit that failed to init. **Do not edit those
   `terragrunt.hcl` files.** Fix the upstream unit and these vanish.
4. **`Required plugins are not installed` under `--all` is an init/plan race.** Two units
   (`secrets`, `bib-secrets`) reported it in a bulk run and then planned cleanly
   (39 and 9 to destroy) when run individually. Re-run the unit, don't debug it.
5. **`GetProviderSchema request was cancelled`** is transient. Retry.
6. **Always pass `--dependency-fetch-output-from-state`.** It reads dependency outputs
   from S3 instead of running the dependency — which is what you want once resources
   start disappearing mid-destroy. Without it, trap 3 reappears for real.

## 4. Known blockers, in the order you will hit them

1. ✅ **CLEARED 2026-09-13** — `state rm`'d `aws_cloudwatch_log_group.app["auth"|"gpx"|"human"]`
   from `admin-reports`; its destroy plan is clean (25 to destroy, no re-import). Kept for
   the record: that unit sets `prevent_destroy = true` on the adopted `/ecs/*` log groups
   (`modules/admin-reports/v1.0.0/retention.tf`), which hard-fails `destroy`. The groups now
   simply outlive the stack (90-day retention self-cleans).
2. **`abuse-detection` must be destroyed while `enabled = true`** (`site.hcl:519`, verified
   still true 2026-10-25). Flipping to `false` first *excludes* the unit and orphans the
   Lambda/Athena/EventBridge resources. 15 resources.
3. **`global/github-oidc` (55 resources) sits 6th in the queue — far too early.** It owns the
   OIDC provider and the `dc34-github-*` roles that `deploy.yml` / `buildpub.yml`
   authenticate with, and it carries **no `prevent_destroy`**. Local SSO is unaffected, but
   destroying it early removes any CI fallback while ~800 resources still stand. **Exclude it
   from the bulk run and do it last, by hand.** (This is also why there is no destroy
   workflow and should not be: a CI-driven destroy deletes the credentials of the job
   running it, mid-run.)
4. **DNS is the point of no return.** `modules/site` owns the
   `email./run./auth./cms./gpx./flash./mqtt./bib.defcon.run` hosted zones plus the NS
   delegations in the mgmt-account apex. Intended end state — but once gone the URLs need
   re-delegation to come back. It is last in the graph anyway.
5. **CloudFront dominates wall clock.** `region/us-east-1/cloudfront` (73) +
   `global/cloudfront` (62) = 135 resources, ~15 min per distribution to disable + delete.
   Budget an hour. Not a failure, just slow.
6. **ACM certs** are `create_before_destroy` and stay attached until CF is gone — they wait on #5.
7. **SES receipt rule set** — the active set cannot be deleted while active. `region/us-east-1/email`
   is the biggest unit (151 resources) and handles this in-graph; if it errors, run
   `aws ses set-active-receipt-rule-set` (no argument) and retry.
8. Fine as-is: ECR `force_delete = true` (immutable images do not block), every
   log/uploads/status bucket is `force_destroy = true` (versions included), DDB tables have no
   deletion protection, `cac1`/`apse1` carry nothing.

## 5. Order

The destroy is **local, not CI** (see blocker #3). Plan first, read it, then go.

```bash
cd infra/terraform/live/site

# 1. Plan and actually read it. Expect: 0 errors, 892 to destroy, 25 units.
terragrunt plan --all -destroy --dependency-fetch-output-from-state \
  2>&1 | tee ~/dc34-destroy-plan.txt
grep -cE 'Error:' ~/dc34-destroy-plan.txt                      # want 0
grep -oE '[0-9]+ to destroy' ~/dc34-destroy-plan.txt \
  | grep -oE '^[0-9]+' | paste -sd+ - | bc                     # want ~892

# 2. Everything except github-oidc. Terragrunt's dependency graph orders the rest.
#    The negated --filter is verified on 0.99.1: the queue drops to 26 units.
terragrunt destroy --all --dependency-fetch-output-from-state \
  --filter '!global/github-oidc'

# 3. CI credentials last, by hand, once you are sure you need no deploy or rollback.
cd global/github-oidc && terragrunt destroy && cd -

# 4. A clean destroy plan means nothing is left in state.
terragrunt plan --all -destroy --dependency-fetch-output-from-state
```

**Flag note.** `--queue-exclude-dir` / `--queue-include-dir` no longer exist in Terragrunt
0.99.1; they were replaced by `--filter` (repeatable, union/OR semantics, `!` negates).
Confirm with `terragrunt run --help` on your version before relying on either spelling. If
filters misbehave, fall back to `cd`-ing into each unit and running plain
`terragrunt destroy`, leaving `global/github-oidc` for last.

If you get interrupted partway you are in a valid-but-partial state: re-run
`plan --all -destroy` to see what is left rather than guessing. Nothing here is
resume-hostile.

## 6. After

- [ ] Sweep for stragglers: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Site,Values=dc34`
      (ECS-auto-created log groups, the three `state rm`'d ones, orphaned ENIs, Lambda log groups).
- [ ] `ca-central-1` / `ap-southeast-1` were never in the destroy queue — confirm nothing
      physical lingers there (the dc35 EIPs you will see are **not** DC34).
- [ ] Decide on `tf-dc34-*` state buckets/lock tables. Keeping them is cheap and state is a
      useful audit trail.
- [ ] Route53 apex: confirm the sub-zone NS delegation records are gone. Dangling NS =
      subdomain-takeover surface.
- [ ] SES: the `defcon.run` domain identity, if not TF-managed, still exists — harmless.
- [ ] Cost Explorer a week later: anything still billing under `Site=dc34`? Pre-destroy
      baseline was ~$95/mo with ECS at zero (NAT $32, ALB $32, public IPv4 $18, KMS, data).
