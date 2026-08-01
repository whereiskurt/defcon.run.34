# Phase 72 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed (SCOPE BOUNDARY: only
issues directly caused by a plan's own changes are auto-fixed).

## From 72-02 (run.human mint/pending/claim)

### Pre-existing `tsc --noEmit` errors in `apps/run.human/webapp` (10)

Present before this plan; none are in files 72-02 touched. Verified with
`git diff --name-only cc799ffd..HEAD` — none of these files appear in the phase diff.

| File | Count | Error |
|------|-------|-------|
| `src/components/header/dropdown-user.tsx` | 1 | TS2307 cannot find module `@public/header/dcjack.svg` |
| `src/entities/__tests__/checkin.test.ts` | 4 | TS2339 `Property 'model' does not exist on type 'Entity<...>'` |
| `src/lib/leaderboard-drill.test.ts` | 5 | TS2339 `Property 'polyline' does not exist` |

### Pre-existing `npm run lint` failures in `apps/run.human/webapp`

App-wide baseline is **63 errors, 46 warnings** — the app does not lint clean today.
None are in files 72-02 touched (verified by scoping eslint to the 9 changed files:
0 errors, 1 pre-existing `_input` unused-var warning in `ctf-pending.test.ts` that
predates this plan).

The plan's verification step 3 ("`npm run lint` — clean") is therefore not
achievable at this baseline and was scoped to the changed files instead.

## From 72-04 (infra authoring)

### Pre-existing HCL format drift in 9 `live/site` files

`terragrunt hcl format --check` ignores its path argument and scans the whole
`live/site` tree, reporting these as needing formatting. All 9 predate this phase and
none were touched by 72-04:

`global/cloudtrail/terragrunt.hcl`, `region/{ap-southeast-1,ca-central-1,us-east-1}/email/terragrunt.hcl`,
`region/{ap-southeast-1,ca-central-1,us-east-1}/region.hcl`,
`services/run.auth/service.hcl`, `services/run.gpx/service.hcl`

Drift is cosmetic (attribute alignment, comment spacing). NOT fixed: running the
formatter tree-wide would sweep 9 unrelated files into an infra PR whose whole point is
a reviewable, minimal fail-closed flip. The three files 72-04 changed
(`site.hcl`, `services/run.mqtt/service.hcl`, `region/us-east-1/admin-reports/terragrunt.hcl`)
are all format-clean.

### `terragrunt hcl validate` needs an explicit AWS profile

Validating any `live/site` unit decrypts `.secrets.sops.json` via KMS, so it fails with
`ExpiredTokenException` unless `AWS_PROFILE=dc34-application` is set (or SSO is fresh).
Not a defect — worth knowing before concluding a unit is broken.

## From 72-08 (rotation + fallback secret)

### The `rick_astley_loves_desert_running` `Qr` row does NOT exist — 72-10 must be amended

`72-10-PLAN.md` line 64 asserts a `Qr` row at `pk = "$run#code_rick_astley_loves_desert_running"`,
`sk = "$qr_1"` and makes deleting it one of teardown's two targets. **There is no such row.**
A `GetItem` on that exact key returns nothing, and a full `__edb_e__ = "Qr"` scan of
`run-human-electro` lists 16 codes, none of them ricky's:

```
%e2%98%8e  %e2%98%8e%ef%b8%8f  b  c  c1800  c3234  c3283  c8283
d  donate  f  g  h  p  r  rick
```

`$run#code_rick` is a DIFFERENT, unrelated row — the 2026-07-12 rickroll redirect to
`https://r.defcon.run`. **Do not delete it.** `setup-ricky-flag.mts` intended to create the
long-code row (it is the second item in that script's put loop) but it is not in the table.

Consequence: teardown has ONE real target, the S3 object, not two. 72-08's teardown stage
already handles this correctly — it reports `Qr row present: no (already gone)` and skips
the delete rather than erroring — so no code change is needed. 72-10's DRY-RUN acceptance
criterion "it must name exactly two targets" should be relaxed to one, and the belief that
the row exists should not be used as evidence that the teardown ran.

### The `terraform-apply` GitHub environment is branch-locked to `main`

`terragrunt-apply.yml` declares `environment: terraform-apply`, and that environment has a
custom deployment-branch policy whose only entry is `main`. A dispatch from any other branch
fails in ~2 seconds with **zero steps executed** and no job log — there is no error message
anywhere in the run, which makes it look like an infrastructure flake rather than a policy
denial. Both non-`main` dispatches in recent history failed this way
(`30669743120` on `worktree-rickyaward`, `30650567272` on `gsd/phase-71-heat-map-layers`);
every `main` dispatch succeeded.

`workflow_dispatch` also declares no `ref` input (only the `workflow_call` path does), so a
`main`-triggered run cannot be pointed at a feature branch's config —
`gh workflow run ... -f ref=<branch>` is rejected with
`HTTP 422: Unexpected inputs provided: ["ref"]`.

**Therefore any terragrunt apply requires its config to be merged to `main` first.** This is
worth stating in future infra plans, which have repeatedly been written as though a scoped
apply can be dispatched from the working branch.
