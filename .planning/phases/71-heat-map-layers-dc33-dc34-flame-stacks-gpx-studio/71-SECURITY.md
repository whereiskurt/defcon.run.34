---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
audited: 2026-07-31
auditor: gsd-security-auditor
asvs_level: 1
block_on: high
register_source: "<threat_model> blocks in 71-01..71-16-PLAN.md (register_authored_at_plan_time: true)"
threats_total: 82
threats_closed: 82
threats_open: 0
threats_open_nonblocking: 0
accepted_risks: 9
unregistered_flags: 0
live_verified_against: "run.gpx v0.0.110 / ECS run-gpx-use1-dc34:200 / CloudFront E1D1R5LJNFGRLE"
status: SECURED
---

# Phase 71 — Security Audit

**Verdict: SECURED.** 82 of 82 registered threats resolve to CLOSED (73 mitigations verified
present, 9 documented accepted risks). Zero blocking-open threats. Zero unregistered attack
surface.

The register is 89 rows across 16 `<threat_model>` blocks; `T-71-SC` repeats in 8 plans and is
verified once, giving **82 unique threats**. Verification depth is ASVS L1 (mitigation present
in the cited file), but because the phase is live, every **high** and **critical** threat was
additionally re-derived against production read-only rather than taken from a SUMMARY claim.

## Independent live evidence gathered by this audit

Not inherited from `71-VERIFICATION.md` or any `*-SUMMARY.md` — re-run from scratch:

| Check | Result |
|---|---|
| `POST /use1/api/gpx/internal/heatmap-build` | `404` + `x-dc34-edge-block: 1` + `x-cache: FunctionGeneratedResponse from cloudfront`, empty body |
| `POST /api/gpx/internal/heatmap-build` (no-region) | same |
| `POST /use1/api/gpx/internal/strava-sync` (inherited sibling) | same |
| Blast radius `run.defcon.run/use1/api/internal/ctf/mint` | `403`, **no** edge marker |
| Blast radius `auth.defcon.run/use1/api/internal/quota/probe-nonexistent-user` | `401`, **no** edge marker |
| `/heatmap/dc32`, `/heatmap/DC34`, `/heatmap/..%2f..%2fROUTES%2fx` | `404`, `404`, `404` |
| `/heatmap/dc33?meta=1` x3 | `Hit from cloudfront` 3/3; `cache-control: public, s-maxage=900, stale-while-revalidate=900` |
| Cache-key separation | bare `439858` B vs `?meta=1` `86` B — distinct entries |
| Live DC33 artifact structural walk | root keys `type,meta,features`; meta keys exactly `year,generatedAt,runCount,totalKm`; 90 features; feature keys exactly `type,properties,geometry`; **0** property keys across all 90; **0** degenerate; **0** out-of-range coords |
| Live DC33 identifier byte sweep | `userId\|accomplishmentId\|stravaActivityId\|summary_polyline\|fileId\|@\|email` → **0 hits** in 439858 bytes |
| `verify-heatmap-artifact.mjs --selftest` | PASS — 3 doctored fixtures rejected (property, at-sign, degenerate) ⇒ **not vacuous** |
| `verify-heatmap-artifact.mjs <live dc33 URL>` | all 7 checks PASS, exit 0, 19961 coordinates all in range |
| `heatmap-build-use1` Lambda | `Timeout: 420`, `ReservedConcurrentExecutions: 1`, VPC 2 subnets |
| Lambda inline IAM policy (live) | logs on own log group only · xray · **one** `ssm:GetParameter` arn · `kms:Decrypt` on `key/31de63fd-…` (**KEY** arn, not alias) with `kms:EncryptionContext:PARAMETER_ARN` condition. **Zero DynamoDB, zero S3.** |
| Lambda trust (live) | `lambda.amazonaws.com` + `aws:SourceAccount` condition |
| Scheduler role (live) | trust `scheduler.amazonaws.com` + `aws:SourceAccount`; sole grant `lambda:InvokeFunction` on one function arn |
| Schedules (live) | daily `cron(20 4 * * ? *)` / hourly `cron(0 * 5-10 8 ? 2026)`, both `America/Los_Angeles`, both ENABLED, retry 2 — **minute 20 vs 0, cannot collide** |
| Cache policy `heatmap-artifact-defcon-run` (live) | cookies `none`, headers `none`, query strings whitelist `["meta"]`, TTL 0/900/3600 |
| ECS (live) | `run-gpx-use1-dc34:200`, running 1/1, image `dc34-run-gpx-app:v0.0.110` |
| Credential sweep over the whole phase dir | `AKIA\|ASIA\|pk.eyJ\|SecretAccessKey\|aws_secret_access_key=\|*_SECRET="literal"` → **0 hits** |
| Supply chain | `git diff --stat 0c1114b8..HEAD` on all four `package.json`/`package-lock.json` → **empty** |
| Terraform module drift | `git diff --stat` on `modules/strava-sync-scheduler/` → **empty** |

## Threat verification — all 82

### Closed by mitigation (73)

| Threat | Category | Sev | Evidence |
|---|---|---|---|
| T-71-01 | DoS | medium | `lib/polyline-decode.ts:31,134` `MAX_POLYLINE_CHARS=200000` rejects before parse; `lib/heatmap-artifact.ts:75-76` bounds output |
| T-71-02 | Tampering | medium | `lib/polyline-decode.ts:55` — parsed value only iterated as array / read by fixed key; never a lookup map or spread target |
| T-71-03 | InfoDisc | **high** | `lib/heatmap-artifact.ts:312-403` `assertNonAttributable`; literal `properties: {}` at `:246`; called on **all three** paths — builder `heatmap-build.ts:295`, backfill `backfill-dc33-heatmap.ts:289`+`:331`, serve `route.ts:137`. **Live**: 0 property keys across 90 features |
| T-71-05 | EoP | **high** | `api/gpx/internal/heatmap-build/route.ts:80-93` — secret resolved and compared before `buildDc34Heatmap()` at `:96`. Superseded upward: denial is now a bare 404 (T-71-11-02) and constant-time (T-71-11-01). **Live**: edge 404 + marker |
| T-71-06 | DoS | **high** | `heatmap-build.ts:71` CHUNK_SIZE=20 · `:256` MAX_RUNS total-work break · `:101,245-249` `BUILD_BUDGET_MS` 240 s abort. **Substitution noted below** |
| T-71-07 | InfoDisc | **high** | `heatmap-build.ts:295` guard is the statement immediately before `putArtifact` at `:297`; no try/catch wrapper |
| T-71-08 | InfoDisc | medium | `heatmap-build.ts:300-302` counts-only log line; route `:99-102` logs detail, returns generic 500 |
| T-71-10 | Tampering | **high** | `public/heatmap/[year]/route.ts:75-77` `isHeatmapYear()` returns 404 **before** `heatmapArtifactKey(year)` at `:82`. **Live**: `dc32`/`DC34`/encoded-traversal all 404 |
| T-71-11 | DoS | **high** | Bounds upstream + `CACHE_SECONDS=900` (`:56-60`) + dedicated CF behaviour. **Live**: Hit 3/3 |
| T-71-12 | InfoDisc | medium | Fixed generic bodies at `:76,102,106,117,144,156,175`; missing artifact → 404, not an oracle 500 |
| T-71-13 | InfoDisc | **high** | Route performs no `auth()` and reads no cookie (grep clean). **Live** policy cookie=`none`, header=`none`; bare vs `?meta=1` are distinct entries (439858 B vs 86 B) |
| T-71-14 | Repudiation | medium | `api/gpx/public/aggregate/route.ts:15-31` — "SUPERSEDED CLAIM — Phase 71, HEAT-06, 2026-07-30" block naming date, owner, and the compensating control, in source |
| T-71-15 | InfoDisc | **high** | `backfill-dc33-heatmap.ts:289` pre-write + `:331` round-trip guard; `scripts/verify-heatmap-artifact.mjs:32-38` byte sweep list. Self-test proven non-vacuous by this audit |
| T-71-16 | InfoDisc | medium | `backfill-dc33-heatmap.ts:83,130` one hardcoded source bucket + prefix, `GetObjectCommand` only, no `ListObjects`, no write to the DC33 account |
| T-71-17 | DoS | medium | Per-line try/catch + skip counter; `MAX_POLYLINE_CHARS` / `MAX_RUNS` / `MAX_TRACK_POINTS` bound the fixed 730-item export |
| T-71-18 | Tampering | medium | DynamoDB-JSON read by fixed literal key paths only; `decodeTrack` never uses parsed values as a map |
| T-71-19 | EoP | medium | `backfill-dc33-heatmap.ts:278` `--apply` flag; write gated at `:316`; `:336` dry-run default. Credentials are the prefix-scoped `uploads/*` IAM user |
| T-71-20 | InfoDisc | **high** | SSM values into one command's env, never echoed. **Audited**: credential regex sweep over the whole phase directory → 0 hits |
| T-71-21 | Tampering | **high** | `heatmap-layer.ts:218-222` `isFeatureCollection` gate before `addSource`; `grep -c 'innerHTML\|insertAdjacentHTML'` → **0**; no `feature.properties` read anywhere in the module |
| T-71-22 | InfoDisc | medium | `credentials: 'omit'` on **both** fetches — `heatmap-layer.ts:305` (meta) and `:320` (geometry) |
| T-71-23 | DoS | medium | Geometry fetched only inside `ensureGeometry`; probe assertion 12 PASS live — `meta=2, bare-before=0, dc34 bare fetches=1` |
| T-71-25 | Tampering | medium | `grep -c '{@html' HeatMap.svelte` → **0**; stamp/hint reach the DOM via Svelte text binding and `data-hint`, both auto-escaping |
| T-71-26 | DoS | low | `heatmap-layer.ts:169-172` — `relativeStamp` returns `'—'` for null and for `!Number.isFinite(Date.parse(iso))` rather than throwing |
| T-71-28 | EoP | **high** | **Live** inline policy read: logs (own group) + xray + one `ssm:GetParameter` + one conditioned `kms:Decrypt`. Zero DynamoDB, zero S3. Only managed attachment is `AWSLambdaVPCAccessExecutionRole` (see T-71-14-04) |
| T-71-29 | EoP | medium | **Live**: trust `scheduler.amazonaws.com`; policy = `lambda:InvokeFunction` on `…function:heatmap-build-use1` only |
| T-71-30 | InfoDisc | **high** | `modules/heatmap-scheduler/v1.0.0/iam.tf:66` `data.aws_kms_alias.ssm.target_key_arn`. **Live** resource is `arn:…:key/31de63fd-…` — a KEY arn, with the `PARAMETER_ARN` encryption-context condition at `:67-71` |
| T-71-31 | Spoofing | **high** | App-layer constant-time guard is the control; Lambda joins the pre-existing `http_only` SG (terragrunt `:113-115`), **no new ingress rule**. Network layer now real and live-verified |
| T-71-32 | DoS | medium | **Strengthened vs plan**: live `lambda_timeout` 420 > invoker fetch 300 > builder 240; `maximum_retry_attempts = 2`; `reserved_concurrent_executions = 1` |
| T-71-33 | Tampering | **high** | `git diff --stat 0c1114b8..HEAD -- infra/terraform/modules/strava-sync-scheduler/` → **empty** |
| T-71-34 | InfoDisc | **high** | **Audited directly**: `verify-heatmap-artifact.mjs` against the LIVE dc33 URL → 7/7 PASS, exit 0. Self-test rejects all 3 doctored fixtures ⇒ non-vacuous. **dc34 leg residual — see R-1** |
| T-71-35 | EoP | **high** | **Live**: unauthenticated POST → `404` + `x-dc34-edge-block: 1` + `FunctionGeneratedResponse from cloudfront`, empty body, on **both** URL spellings and on all three internal routes |
| T-71-36 | DoS | medium | **Live**: `x-cache: Hit from cloudfront` 3/3 with `s-maxage=900` present on the response |
| T-71-37 | Tampering | **high** | `71-08-probes/heatmap-probe.cjs:71` `const TOTAL = 19;` — fixed literal set in `96cd4fd1`/`f6aeb9ac` before the post-deploy run; `git log --follow` shows no commit to the probe after `f6aeb9ac` |
| T-71-38 | Repudiation | medium | Contrast is real: `transcript-gap-pre.txt` → 8/19; `transcript-gap-post.txt` → 17/19, same script |
| T-71-39 | Tampering | **high** | `transcript-phase70-regression-gap.txt` → **16/16**, full denominator, archived beside the new transcript |
| T-71-40 | InfoDisc | **high** | Token read from env only (`heatmap-probe.cjs:160`); token/credential sweep over transcripts and the phase dir → 0 hits |
| T-71-SC | Tampering | **high** | Zero packages installed phase-wide: `git diff --stat` on `run.gpx/webapp` and `gpx-studio/website` `package.json` + `package-lock.json` → **empty**. Invoker Lambda has no dependency manifest (single `@aws-sdk/client-ssm` import from the runtime) |
| T-71-09-01 | Tampering | medium | `heatmap-layer.ts:219-221` — **both** surviving checks present: `o.type === 'FeatureCollection' && Array.isArray(o.features)`. Only the length clause was removed |
| T-71-09-02 | DoS | low | `heatmap-layer.ts:242,252-261` — `STYLE_READY_TIMEOUT_MS = 10_000` raced against `map.once('idle')`; **resolves**, never rejects |
| T-71-10-01 | InfoDisc | **high** | All three former blind spots are now real checks: root `type` literal `:321-325`, `meta` key walk `:326-334`, `coordinates` element/pair/number walk `:383-401` |
| T-71-10-02 | InfoDisc | **high** | `public/heatmap/[year]/route.ts:136-146` — guard runs on the **serve** path; a failing object returns 500, never publishes |
| T-71-10-04 | InfoDisc | medium | `route.ts:100` and `:172` log `error.name` only; the caught object is never passed to console |
| T-71-10-05 | DoS | low | `route.ts:98,105` use `console.warn` for the ordinary miss; only corrupt-object paths use `console.error` |
| T-71-10-06 | Tampering | medium | `heatmap-artifact.ts:240-241` degenerate filter at the single assembly point; verifier `:156-162` fails it; **live DC33 rebuilt: 90 features, 0 degenerate** (was 110 with 20 at null island) |
| T-71-11-01 | Spoofing | **high** | `internal/heatmap-build/route.ts:2,61-67` — `timingSafeEqual` behind an explicit length check |
| T-71-11-02 | InfoDisc | medium | `route.ts:50` `NOT_FOUND()` bare 404, used at `:89` and `:92`. **Live** behaviour now 404 at the edge anyway |
| T-71-11-03 | DoS | **high** | *mitigate (partial) + transfer.* App half: `BUILD_BUDGET_MS` + `MAX_RUNS` break + `CHUNK_SIZE`. **Transfer half verified**: the 71-13 edge block removes internet reachability (live-probed above), and the transfer is documented — not silently dropped — at `71-11-SUMMARY.md:51,191-199` ("Rate limiting / lockout / audit log … DEFERRED to the 71-13 edge block, named in the threat register rather than omitted") |
| T-71-11-04 | DoS | **high** | Chain strictly increasing and **live-verified**: `heatmap-build.ts:101` 240 s < `lambda/index.mjs:42` 300 s < live Lambda `Timeout: 420`. See R-2 |
| T-71-11-05 | Tampering | medium | `heatmap-build.ts:245-249` throws on deadline; `putArtifact` at `:297` is unreachable from that branch |
| T-71-12-01 | InfoDisc | medium | `heatmap-probe.cjs:160` env-only; transcript sweep for `pk.` / `eyJ` → 0 |
| T-71-12-02 | Tampering | **high** | `TOTAL = 19` fixed literal; pre-transcript committed unchanged; 71-16 re-ran the byte-identical script |
| T-71-12-04 | Spoofing | **high** | `heatmap-probe.cjs:129` `EDGE_MARKER_HEADER`. **Audited**: the marker arrives with `x-cache: FunctionGeneratedResponse from cloudfront` — CloudFront-generated and unforgeable by the app; the app's own 404 body is empty |
| T-71-13-01 | DoS | **critical** | `modules/cloudfront/v1.0.0/main.tf:212-244` policy + `:687-704` behaviour. **Live**: Hit 3/3 |
| T-71-13-02 | EoP | **critical** | `main.tf:620-644` (region form) + `:652-670` (no-region form), both with `function_association` → `internal_block`. **Live**: 6/6 refused with the marker, strava-sync sibling included |
| T-71-13-03 | DoS | **high** | Scope pinned by `each.key == "gpx"` at `:621` and `:653`, prefix `/api/gpx/internal/*` only. **Live**: run.human mint `403` and run.auth quota `401`, **neither carrying the marker**; Kurt additionally exercised two real ghost claim links (goldstein, mudge) end to end |
| T-71-13-04 | InfoDisc | **high** | `main.tf:227-233` cookie/header `none` + `:235-240` `meta`-only whitelist + `:202-208` revisit instruction. **Live** policy read confirms all three |
| T-71-13-05 | Tampering | **high** | Line-number ordering re-derived by this audit: internal blocks at **620** and **652**, heat-map cache at **687**, `/{region}/*` wildcard at **710** — all three above the wildcard. Live behaviours are active, which is only possible if they match first |
| T-71-13-06 | DoS | **high** | Cloud Map path never traverses CloudFront (`terragrunt.hcl:108` `sync_url` = `http://run-gpx.…local:3000/…`). Proven behaviourally: an unattended scheduled build completed at `2026-07-31T11:00:36Z` and the live dc34 artifact carries `generatedAt: 2026-07-31T18:32:03.294Z` |
| T-71-14-01 | DoS | **high** | **Live**: daily `cron(20 4 * * ? *)` vs hourly `cron(0 * 5-10 8 ? 2026)` — minute fields 20 and 0, cannot co-fire |
| T-71-14-02 | DoS | **high** | **Live** Lambda `Timeout: 420`; fetch bound 300; builder 240 |
| T-71-14-03 | EoP | medium | **Live**: `aws:SourceAccount` StringEquals condition on **both** the Lambda trust and the scheduler trust |
| T-71-14-05 | InfoDisc | low | `lambda/index.mjs:65` keeps the 500-byte body only on `!res.ok`; `:68` logs status + byte count on success; `:29` throws without interpolating the SSM path |
| T-71-14-06 | DoS | medium | **Live** `ReservedConcurrentExecutions: 1`; account-settings measurement recorded in 71-14-SUMMARY rather than set blindly |
| T-71-15-01 | Tampering | **high** | Round-trip `assertNonAttributable` at `backfill-dc33-heatmap.ts:331`, not wrapped in a continuing catch; verifier run against the live URL; blocking human approval recorded |
| T-71-15-02 | InfoDisc | **high** | Same `assembleHeatmapArtifact`; **this audit independently re-walked the live bytes** — no widening (root/meta/feature/geometry key sets exact) |
| T-71-15-03 | Repudiation | medium | `71-15-SUMMARY.md:77-80` records Kurt's approval on 2026-07-31 against the measured 110→90 contrast table; in-place contract note carries date, reason, invariants |
| T-71-15-04 | Tampering | medium | **Live** `generatedAt` is still `2025-08-15T02:41:54.347Z` — the frozen export instant, byte-identical pre/post rebuild |
| T-71-15-05 | DoS | low | Invalidation `IAX573OYBXW9L50YLMZ319H9GS` created and waited to `Completed`; re-derivation done on a proven cache Miss, not a cache-buster |
| T-71-16-01 | Tampering | **high** | `git log --follow` on `heatmap-probe.cjs` — last commit `f6aeb9ac`, before the post-deploy run; no post-hoc edit exists |
| T-71-16-02 | DoS | **critical** | Assertion 16 PASS post-deploy; **independently re-confirmed live** (mint/quota carry no marker); Kurt's two real claim links worked |
| T-71-16-03 | InfoDisc | medium | Sweep of transcripts and `SCREENSHOTS.md` for `pk.`/`eyJ` → 0 |
| T-71-16-04 | Tampering | **high** | **Substituted evidence, stronger than the plan's command.** The plan's `curl /use1/ \| grep v0.0.x` cannot work — run.gpx exposes no version over HTTP. Replaced with ECS/ECR reads, and **this audit independently confirmed** `run-gpx-use1` → TD `:200` → image `dc34-run-gpx-app:v0.0.110`, running 1/1 |
| T-71-16-05 | Repudiation | medium | `71-16-SUMMARY.md:234-244` gives a per-assertion pre/post table with a written cause for each of the 2 remaining reds; assertions 5 and 11 were **not** softened (verified: `TOTAL` still 19, `isFeatureCollection` still gates) |

### Closed as documented accepted risk (9)

Two are **user-locked decisions**. They are recorded, not reopened.

| Threat | Category | Sev | Rationale & where it is recorded |
|---|---|---|---|
| **T-71-10-03 / CR-02** | InfoDisc | **high** | **USER-LOCKED — D-14.** Exact start/end coordinates at ~1.1 m for non-consenting runners. Kurt's explicit call on 2026-07-31, made with the exposure stated plainly ("often a hotel room door"), following his 2026-07-30 HEAT-06 decision to ship with **no opt-in gate**. The proposal he declined was endpoint trimming plus precision reduction. Recorded in **code** at `lib/heatmap-artifact.ts:125-149` and in `71-CONTEXT.md` → Gap-Closure Decisions. `assertNonAttributable` is the sole compensating control, and the residual gap is stated honestly in the guard's own docstring (`:303-310`): it proves the artifact carries no identifier **fields**, which is a different property from "not re-identifiable from geometry". **Reversal requires a new user decision — not a code review comment.** |
| **T-71-04** | InfoDisc | low | **USER-LOCKED.** `COORD_PRECISION = 5` retained because a coarser grid visibly quantises the stacked-line render. Documented `heatmap-artifact.ts:56-77` and in the D-14 block. Residual bounded by the absence of timestamp, id and ordering metadata on any feature |
| T-71-09 | Spoofing | low | `!==` secret comparison, accepted for parity with the shipped `strava-sync` guard. **Now moot** — 71-11 replaced it with `timingSafeEqual` |
| T-71-24 | Tampering | low | Hand-edited `dc34LayerVisibility` in localStorage; `layer-visibility.ts:76-81` coerces to booleans only; worst outcome is a self-inflicted extra layer |
| T-71-27 | Tampering | low | Hand-edited collapse store; `layer-section-collapse.ts:56-60` coerces to booleans only |
| T-71-09-03 | InfoDisc | low | The zero-run hint text renders only `runCount`, `totalKm`, `generatedAt` — all already public at `?meta=1`. Documented `71-09-SUMMARY.md` Threat Flags |
| T-71-11-06 | Repudiation | low | No audit log of authorized invocations. Deferred for con week; the build already logs counts on every run and new state is new failure surface days out. Named, not omitted — `71-11-SUMMARY.md:51,193-196` |
| T-71-12-03 | DoS | low | Probe POSTs to live internal endpoints. All 6 are unauthenticated and rejected; assertion 16 deliberately uses GET so no mint endpoint is exercised. `71-12-SUMMARY.md:238` |
| T-71-14-04 | EoP | medium | `AWSLambdaVPCAccessExecutionRole` grants `logs:*` account-wide, broader than the hand-written statement. Count-gating the attachment changes its resource address ⇒ Terraform destroy-then-create ⇒ a live IAM detach during con week for zero behavioural change. Deferred post-con. Recorded honestly in code at `modules/heatmap-scheduler/v1.0.0/iam.tf:84-98` (the misleading "harmless" comment was replaced) and in `71-14-SUMMARY.md:40,574` |

## Unregistered flags

**None.** All 9 `## Threat Flags` sections across the 16 SUMMARYs report "None beyond the plan's
register." Spot-checked against the diff: this audit found no new network endpoint, auth path,
file-access pattern or trust-boundary schema change outside the register.

## Residual observations (advisory — not open threats, not blocking)

These are recorded so they are not rediscovered as surprises. None is a missing declared
mitigation; each is a tracked follow-up.

**R-1 — Probe assertion 5's dc34 leg is vacuous until the con.**
`verify-heatmap-artifact.mjs` requires `meta.runCount > 0`, and the live DC34 artifact is
structurally valid but empty (0 features) because DEF CON 34 is 2026-08-05..10. So T-71-34's
"both years verified on production bytes" is proven for dc33 only. This audit confirmed the
failure is emptiness, not attribution — the runtime compensating control (T-71-10-02, the
serve-path guard on every origin request) covers the gap, and the assembler + write-path guard
cover the build. **Action: re-run `71-08-probes/heatmap-probe.cjs` unmodified during 5-10 Aug
and require assertion 5 green.** The same cause makes assertion 11 red; both were correctly
documented rather than softened.

**R-2 — `modules/heatmap-scheduler/v1.0.0/variables.tf:75` still defaults `lambda_timeout = 300`,
equal to the invoker's own 300 s fetch bound.**
The live `us-east-1` unit overrides it to 420 (`terragrunt.hcl:169`, confirmed live), so the
chain is intact today. But a second instantiation that omits the override would collapse
420 > 300 into 300 == 300 — precisely T-71-11-04's stated failure mode (invoker killed
mid-flight, retry policy stacks concurrent rebuilds). The variable's own description already
warns "Equal is NOT enough". **Suggested post-con: raise the default to 420.**

**R-3 — Two SUMMARY threat tables cite superseded numbers.**
`71-02-SUMMARY.md` credits T-71-06 to `maxDuration = 300` and `71-07-SUMMARY.md` credits T-71-32
to `lambda_timeout = 300`. Both were later found inert/insufficient and replaced by
`BUILD_BUDGET_MS = 240` + the 240/300/420 chain (71-11, 71-14). The **live** posture is stronger
than those tables claim; the tables are stale, not wrong-in-direction. Verified against code and
production, not against the summaries.

**R-4 — The sibling internal routes still carry the pre-71-11 guard style.**
`api/gpx/internal/strava-sync/route.ts:23-24` and `api/gpx/internal/reconcile/route.ts:21-22`
still use `!==` (not `timingSafeEqual`) and return `403` (not the non-disclosure 404), and
strava-sync's header comment at `:12` still asserts "never exposed via CloudFront" — a claim that
is true *only because of* 71-13's edge block, not on its own merits. This is outside Phase 71's
register and was explicitly named as out-of-scope (`71-11-SUMMARY.md:52,197-199`). Both routes
are now network-covered — this audit verified strava-sync returns the edge-block 404 from the
open internet. **Filed post-con.**

**R-5 — `71-16-SUMMARY.md:237-239` gives a stale cause for assertion 11**, attributing it to a
`features.length > 0` clause in `isFeatureCollection`. That clause was removed by 71-09; the
current gate is `type === 'FeatureCollection' && Array.isArray(features)` and the live probe
shows the dc34 layer *is* created with 0 features. Documentation-only; the code is correct and
T-71-09-01 verifies clean.

## Ship gate

`threats_open: 0` at `block_on: high`. No blocking finding. **Phase 71 is cleared to ship.**
