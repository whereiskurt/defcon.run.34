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
