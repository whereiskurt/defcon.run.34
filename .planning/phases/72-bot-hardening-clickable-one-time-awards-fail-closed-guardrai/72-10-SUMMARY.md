---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 10
subsystem: ctf
tags: [teardown, s3, cloudfront, invalidation, dynamodb, prod-mutation, probe, todos]
status: complete
requires:
  - "72-08: the ricky answerHash rotation that made the published code stop awarding"
  - "72-09: run.human v0.0.134 + meshtk v0.0.83 deployed and proven serving in us-east-1"
provides:
  - "the legacy static interstitial is DELETED and dead through CloudFront (403)"
  - "three deliberately-deferred items filed as todos with evidence"
  - "probe-bot-hardening.sh liveness checks corrected to read ground truth"
affects:
  - "defcon.run/qr/rick_astley_loves_desert_running — now 403, permanently"
  - "s3 defcon-run-static-20240523-v1 (one object removed)"
tech-stack:
  added: []
  patterns:
    - "full composite-key GetItem as the deletion predicate — never a prefix match, because a shorter key on the same prefix was a different LIVE row"
    - "prove the CDN serves the exact object about to be deleted by matching the live response ETag against the S3 object's before deleting"
    - "measure liveness from the newest log EVENT, not from describe-log-streams' eventually-consistent lastEventTimestamp"
key-files:
  created:
    - .planning/todos/pending/2026-07-31-llm-rate-limiting-bedrock-ceiling.md
    - .planning/todos/pending/2026-07-31-per-bot-mint-secret-scoping.md
    - .planning/todos/pending/2026-07-31-bots-cac1-deployment.md
  modified:
    - .planning/phases/72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai/probe-bot-hardening.sh
decisions:
  - "Refused to work around the expired SSO token with `aws configure export-credentials`. Env credentials outrank AWS_PROFILE in the CLI chain, so the script's S3 execFileSync child — which sets AWS_PROFILE=sudo-management — would have run against 427284555693 instead of 481723467561. Waited for a real `aws sso login` rather than introduce a credential-precedence subtlety into an irreversible delete under an elevated profile."
  - "Accepted the teardown DRY-RUN naming ONE live target rather than the plan's stated two. The Qr row never existed; 72-08 established this and the plan carries the correction inline. Its absence is expected, not a failure, and not evidence the teardown already ran."
  - "Proved the deletion target was the object CloudFront actually serves by matching the live response ETag (07121a6902ad640117f7cd3f922ab9de) to the S3 object's before deleting, rather than trusting the path mapping."
  - "Fixed probe-bot-hardening.sh rather than waiving its one red assertion. A standing regression gate that false-alarms on a healthy container is worse than no gate — the next operator would learn to ignore it."
metrics:
  duration: ~35 min (including a ~25 min hold on an expired SSO session)
  completed: 2026-08-01
---

# Phase 72 Plan 10: Tear Down the Legacy Ricky Path Summary

The freely-shareable static interstitial that published a claim code in plaintext is
**deleted at origin and dead through CloudFront** — `defcon.run/qr/rick_astley_loves_desert_running`
returns **403**, invalidation `IDWGPBKAY5MMC3ETOEVYLIC61R` reached **Completed**, and the
post-teardown probe is **27 pass / 0 fail** with the eight-code md5 unchanged.

Exactly **one** object was deleted. Nothing in DynamoDB was touched.

## Status: 2 of 3 tasks complete, 1 outstanding and owned by Kurt

| Task | State |
|------|-------|
| 1 — teardown, invalidate, re-probe | **complete** |
| 2 — hardware UAT | **OUTSTANDING — Kurt's to perform.** Not attempted, not claimed. |
| 3 — file the three deferred todos | complete |

## Task 1 — the irreversible half

### The pre-gate ran FIRST, before anything was destroyed

The plan is explicit that the teardown must not run if the new award path is not live:

```
/a/probe          302 https://run.defcon.run/use1/ctf/claim?nonce=probe
/a/PROBE00000000  302 https://run.defcon.run/use1/ctf/claim?nonce=PROBE00000000
/A/PROBE00000000  302 https://run.defcon.run/use1/ctf/claim?nonce=PROBE00000000
```

All eight short codes were also confirmed serving their 72-09 destinations, and the legacy
interstitial still returned `200`/474 bytes. The old path was alive right up to the moment
it was removed, so there was never a window with neither path working.

### The DRY-RUN named ONE live target, not two

The script's header text is hardcoded to say "Two targets, no more" and lists both; it then
resolves target 1 to absent:

```
Stage: teardown  Mode: DRY-RUN  Table: run-human-electro  Region: us-east-1  Profile: dc34-application
  1) DynamoDB  run-human-electro  pk=$run#code_rick_astley_loves_desert_running  sk=$qr_1
  2) S3        s3://defcon-run-static-20240523-v1/qr/rick_astley_loves_desert_running
  Qr row present: no (already gone)
DRY-RUN: deleted NOTHING.
```

| # | Target | State at DRY-RUN |
|---|--------|------------------|
| 1 | DDB `run-human-electro` pk=`$run#code_rick_astley_loves_desert_running` sk=`$qr_1` | **ABSENT** — `GetItem --consistent-read` returns no Item |
| 2 | S3 `defcon-run-static-20240523-v1` key `qr/rick_astley_loves_desert_running` | **PRESENT** — 474 bytes, ETag `07121a6902ad640117f7cd3f922ab9de` |

Per 72-08 and the plan's inline correction, the `Qr` row never existed — `setup-ricky-flag.mts`
intended to create it but that write never landed. Absence is the expected reading, not a
failure, and not evidence the teardown had already run.

### `$run#code_rick` was never at risk, and is verified alive AFTER the delete

The dangerous confusion this plan had to avoid is a key that shares a prefix with the target.
It was read before and re-read after:

```
code=rick  destination=https://r.defcon.run  enabled=true  createdAt=2026-07-12T18:10:07.546Z
```

Unchanged. The script's predicate is `doc.get({TableName, Key:{pk, sk}})` — a full composite-key
GetItem. There is no `query`, no `begins_with`, and no scan anywhere in the teardown path, so a
prefix match is not merely avoided by care but impossible by construction. Every manual probe
used a full `--key` as well.

### Chain of custody: the deleted object IS what the CDN was serving

Established before deleting, so the invalidation could not target the wrong distribution:

- `ETHVMDHQC21EG` aliases: `defcon.run`, `*.defcon.run`; origins include
  `defcon-run-static-20240523-v1.s3.us-east-1.amazonaws.com`.
- Live response ETag `07121a6902ad640117f7cd3f922ab9de` == the S3 object's ETag. The bytes the
  edge served were that object, not a same-path object from the other origin.
- `CustomErrorResponses: null` and no extra cache behaviors — so a deleted object would surface
  as a genuine 4xx rather than a remapped 200 that reads like success.

### The delete, the invalidation, and the wait

```
Stage: teardown  Mode: WRITE
  Qr row present: no (already gone)
  ✓ deleted s3://defcon-run-static-20240523-v1/qr/rick_astley_loves_desert_running
```

| Item | Value |
|------|-------|
| Invalidation id | **`IDWGPBKAY5MMC3ETOEVYLIC61R`** |
| Path | `/qr/rick_astley_loves_desert_running` |
| Created | 2026-08-01T00:33:56Z |
| Status | **`Completed`** (waited via `cloudfront wait invalidation-completed`, confirmed by a follow-up `get-invalidation`, not merely submitted) |

Post-delete origin state: `head-object` → `An error occurred (404) when calling the HeadObject
operation: Not Found`. `list-objects-v2 --prefix qr/rick` → `null`. The bucket holds no
remaining object under that prefix.

### The old URL is dead

```
attempt 1: status=403 bytes=111
attempt 2: status=403 bytes=111
attempt 3: status=403 bytes=111

HTTP/2 403
server: AmazonS3
x-cache: Error from cloudfront
```

403 rather than 404 because the distribution's origin access cannot `ListBucket`, so a missing
key is an AccessDenied. Either is correct; what matters is that it is not 200. The plan's own
verify one-liner prints `legacy interstitial is dead`.

The interstitial's contents are not reproduced anywhere in this SUMMARY, in the commits, or in
the transcript — it embedded the superseded code in plaintext three times. `<redacted>`.

### Post-teardown regression probe: 27 pass / 0 fail

```
8-code block md5: cd9dd6384ee47fd126de526b09a4fa50  ==  72-05 baseline cd9dd6384ee47fd126de526b09a4fa50
/a/PROBE00000000 -> 302     /A/PROBE00000000 -> 302
live version v0.0.134   ghosts image meshtk:v0.0.83
run-mqtt-use1-dc34:125 COMPLETED    run-human-use1-dc34:229 COMPLETED
dcr-mqtt-guardrail-outage state = OK
```

The award paths survive and the eight-code block is byte-identical to the 72-05 baseline, which
is the standing gate 72-09 asked for.

## Task 2 — hardware UAT: OUTSTANDING

**Not performed. Not attempted. Not claimed.** It requires a real radio on the dc.run mesh and
a signed-in browser session, and the specific defect it retests (the line-01 drop) was only ever
observed on hardware at the iOS-proxy-to-BLE hop. It is Kurt's to run.

The ten-step script is in `72-10-PLAN.md` Task 2. Step 9 of it — "confirm the old page is dead" —
is the one step already discharged above; the other nine are open. When it is run, the result
belongs here **verbatim**, including any failure detail, per acceptance criterion T-72-57.

## Task 3 — the three deferred items, filed

All three exist, are non-empty, match the existing pending-todo format, name the exact code
location to start from, and record *why* each was deferred. Leak check
(`grep -ciE 'nggyu|ctf/claim\?|q\.defcon\.run/a/|nonce='`) = **0** across all three.

| Todo | Priority | The evidence it carries |
|------|----------|--------------------------|
| `2026-07-31-llm-rate-limiting-bedrock-ceiling.md` | medium | `llm.go:23` Haiku 4.5 via Bedrock `Converse` at `llm.go:71-90`, no per-radio budget / token ceiling / concurrency cap / breaker. Only throttle anywhere is `requestDedupWindow` (`cmd.go:758`), 30s, byte-identical repeats only. Explicitly records that the Phase 72 lyric semaphore (`cmd.go:257`, default 12) bounds **RF fan-out only** and is not a rate limit. |
| `2026-07-31-per-bot-mint-secret-scoping.md` | medium | `mint/route.ts:108-109` is a bare constant-compare on `x-internal-secret`; the challenge is caller-supplied and unconstrained by the credential. |
| `2026-07-31-bots-cac1-deployment.md` | low | The gate is `site.hcl:8` `skip_regions` — the region is switched off site-wide, not merely un-applied. Names the ghosts env, every SSM param that must exist in cac1 *before* the ecs-task apply, and the `main`-only dispatch constraint. |

**Scope correction, contributed by the team lead as `2bfbf242` and independently re-verified
here:** `jwt/internal_secret` is read by **seven** services, not two — run.auth:267, run.bib:173,
run.gpx:193, run.flash:163, run.human:178, run.cms:249, run.mqtt:372. A foothold in any of them
can mint arbitrary CTF claims. This widens the blast radius but does not change the deferral.

## Deviations from Plan

**1. [Auth gate — not a deviation, a hold] Expired SSO session blocked the teardown for ~25 minutes**
- **Found during:** Task 1, first DRY-RUN attempt
- **Issue:** `CredentialsProviderError: Token is expired`. The `Developer` SSO access token expired
  at 2026-07-31T23:25:48Z. Both `dc34-application` and `sudo-management` hang off that one session.
  The AWS **CLI** kept working from separately-cached role credentials (valid to 04:27Z/06:07Z),
  so every read-only verification succeeded — but the **SDK** the script uses reads the SSO token
  directly and died at `getRow`.
- **Resolution:** Held for a real `aws sso login`. Explicitly did **not** use
  `aws configure export-credentials`: env credentials outrank `AWS_PROFILE` in the CLI chain, so
  the script's S3 `execFileSync` child (which sets `AWS_PROFILE=sudo-management`) would have run
  against account 427284555693 instead of 481723467561 — wrong account, elevated profile,
  irreversible delete. Verified `AWS_ACCESS_KEY_ID`/`SECRET`/`SESSION_TOKEN` were all empty
  immediately before the `--confirm` run, and that `sudo-management` resolved to 481723467561.
- **Commit:** n/a

**2. [Rule 1 - Bug] `probe-bot-hardening.sh` reported a healthy container as dead**
- **Found during:** Task 1, post-teardown probe (26 pass / **1 fail**)
- **Issue:** Assertion 6 failed: "ghosts log stream is stale or absent — container may not be
  running", last event 1894s ago. ECS disagreed: task `RUNNING`, `HEALTHY`, 1h48m uptime on the
  same revision 125, zero new streams (no crash loop). The probe reads
  `describe-log-streams.lastEventTimestamp`, which is **eventually consistent** — AWS documents
  it "typically updates in less than an hour". Measured directly: the field read `1785542591813`
  (00:03:11Z) while the stream's newest actual event was `1785544531813` (00:35:31Z, 22s old).
  ~32 minutes stale.
- **Fix:** Both freshness checks now take the timestamp from the newest event itself via
  `get-log-events`, falling back to the old field only if that yields nothing. The guardrails
  sidecar check had the identical latent defect — its 30-minute threshold is wider than the
  ghosts check's 15, but an hour of permitted skew can exceed it too. Also confirmed the ghosts
  log carried **0** matches for error/panic/fatal, `MESHTK_GUARDRAIL_OUTAGE`, and mint-failure
  patterns over the 23:28→00:35 window (counted, never printed — those lines can embed the
  fallback URL).
- **Result:** 26/1 → **27/0**. The container was never unhealthy; only the measurement was wrong.
- **Commit:** `2af9c2b6`

**3. [Scope note] The plan's acceptance criterion "the DRY-RUN named exactly two targets" was
read as ONE**, per the correction block 72-08 wrote into Task 1 of the plan. Recorded here so
the divergence from the criterion as literally written is visible rather than silently satisfied.

## Threat Register Outcomes

| Threat ID | Outcome |
|---|---|
| T-72-54 (tearing down before the new path is proven) | **Mitigated.** The award-namespace probe returned 302 on all three forms *before* any deletion, on top of 72-09's 27/0 deploy proof. |
| T-72-55 (code still served from the edge after origin deletion) | **Mitigated.** Invalidation `IDWGPBKAY5MMC3ETOEVYLIC61R` waited to `Completed`, then the URL re-probed three times: 403 every time, `x-cache: Error from cloudfront`. |
| T-72-56 (deleting the wrong object or row under an elevated profile) | **Mitigated.** DRY-RUN reviewed and reported before `--confirm`; full-composite-key GetItem only; live ETag matched the S3 object before deleting; `$run#code_rick` re-read intact afterwards; env-credential check run immediately before the delete to prevent the S3 child binding the wrong account. |
| T-72-57 (UAT failures summarised away) | **Not yet exercised.** The UAT has not run. Recorded as outstanding rather than reported as passed. |
| T-72-58 (unbounded model spend and abuse) | **Accepted, and now recorded.** Filed with its evidence as `2026-07-31-llm-rate-limiting-bedrock-ceiling.md`. |

## Known Stubs

None.

## Threat Flags

None. This plan removed one public static asset and added three planning documents. It
introduced no network endpoint, auth path, file-access pattern, or trust-boundary schema change.

One pre-existing defect worth noting for a future session, not introduced here:
`rotate-ricky-flag.mts:257-261` builds the S3 child's environment as
`{...process.env, AWS_PROFILE: S3_PROFILE}`. If an operator happens to have
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` exported, those outrank
`AWS_PROFILE` and the delete silently targets whatever account those credentials belong to.
Guarded by hand this time; the script should `delete` those three keys from the child env.

## Verification

| # | Check | Result |
|---|-------|--------|
| 1 | Award-namespace probe returned 302 before any deletion | **PASS** (`/a/probe`, `/a/…`, `/A/…`) |
| 2 | DRY-RUN reviewed, reported, and deleted nothing | **PASS** (one live target) |
| 3 | Deletion completed under `--confirm` | **PASS** (origin 404, prefix listing null) |
| 4 | `$run#code_rick` intact after the delete | **PASS** (→ `https://r.defcon.run`, enabled) |
| 5 | CloudFront invalidation reached `Completed` | **PASS** (`IDWGPBKAY5MMC3ETOEVYLIC61R`) |
| 6 | Old URL returns non-200 | **PASS** (403 ×3) |
| 7 | Eight-code md5 unchanged | **PASS** (`cd9dd6384ee47fd126de526b09a4fa50`) |
| 8 | `/a/<token>` and `/A/<token>` still 302 | **PASS** |
| 9 | Full post-teardown probe | **PASS** 27/0 |
| 10 | Three todo files exist, non-empty, leak-free | **PASS** |
| 11 | Hardware UAT (9 required steps) | **NOT RUN — Kurt's, outstanding** |

## Commits

| Task | Commit | Scope |
|------|--------|-------|
| 3 | `ce92101b` | `docs(72-10): file the three deliberately-deferred Phase 72 items as todos` — 3 files |
| 3 | `2bfbf242` | `todo(72): correct the mint-secret scope — shared across SEVEN services` (team lead; re-verified here) |
| 1 | `2af9c2b6` | `fix(72-10): probe liveness checks read ground truth, not an eventually-consistent field` |

Task 1's deletion is a production mutation with no repository artifact of its own; its evidence
is the invalidation id, the origin 404, and the 403 probes above.

## Outstanding

1. **Kurt's hardware UAT** — the ten-step script in `72-10-PLAN.md` Task 2. Nine steps open.
2. **STATE.md / ROADMAP.md rollup** — deliberately NOT touched here; the team lead owns it.

## Self-Check: PASSED

- All 5 claimed files present on disk.
- All 3 claimed commits found in `git log` (`ce92101b`, `2bfbf242`, `2af9c2b6`).
- `IDWGPBKAY5MMC3ETOEVYLIC61R` re-queried after writing this SUMMARY: still `Completed`.
- `git grep -lE 'nggyu-[0-9a-f]{24}'` across the whole tree at HEAD returns **0 files**. The
  superseded code lived only in the S3 HTML that this plan deleted, and never in git.
