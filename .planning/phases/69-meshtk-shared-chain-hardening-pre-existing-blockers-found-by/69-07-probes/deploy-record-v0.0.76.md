# 69-07 Task 2 — release and deploy record (meshtk v0.0.75 → v0.0.76)

Everything below is recorded verbatim at the time it was taken. No local
`terragrunt apply` was run; the deploy is attributable to a `deploy.yml` run id.

## Pre-release state

| Item | Value |
|------|-------|
| `origin/main` at dispatch | `f7d19592f6adb26d36aa540a9a7e06d92daea229` |
| 69-06 vendor-sync merge is an ancestor of `origin/main` | **yes** (`git merge-base --is-ancestor` exits 0) |
| `apps/run.mqtt/meshtk/VERSION` before | `v0.0.75` |
| Serving image | `dc34-run-mqtt-meshtk:v0.0.75` |
| Task definition | `run-mqtt-use1-dc34:118` |
| Old task | `1762b3b7e0ee4f688c69842fb2bcac29` (RUNNING, HEALTHY) |
| Old log stream | `meshtk/run-mqtt-meshtk/1762b3b7e0ee4f688c69842fb2bcac29` |

`rollback.yml` was read and confirmed NOT to list `run.mqtt` (its `app` choice
list is run.auth / run.human / run.cms / run.gpx / run.flash). Rollback for this
service therefore means redeploying the previous tag through `deploy.yml`.

## buildpub

```
gh workflow run buildpub.yml -f apps=run.mqtt -f regions=use1
```

| Item | Value |
|------|-------|
| Run id | **`30556427674`** |
| Conclusion | **`success`** |
| Window | 2026-07-30T15:23:21Z → 15:29:02Z |
| Release PR | **#1107** "Bump versions for release: run.mqtt" — opened AND auto-merged by buildpub |
| VERSION commit on `origin/main` | `4140ef08 Bump versions for release: run.mqtt (#1107)` (2026-07-30T15:28:48Z) |
| New VERSION | **`v0.0.76`** — bumped by buildpub, not by hand, no `--skip-bump` |
| New immutable ECR tag | `dc34-run-mqtt-meshtk:v0.0.76` |
| Image digest | `sha256:95fb801a046bdf55b1cc627ec552a03a9af1816e1a8f568fe8d6cc76f71a7216` |
| Pushed at | 2026-07-30T15:25:01.582Z |

ECR immutability did not fire, which is the expected outcome of a real bump.

### MQFX-06 build-time assertion, exercised in this build's log

From run `30556427674`, step "Run release-all.sh", Docker stage-1 step 11/11:

```
#24 0.051 meshtk GPX route assertion: verified 24 routes present in /app
```

The assertion is non-vacuous by construction — it hard-fails when the shipped
config contains no `GPXFile:` entries at all:

```
if [ -z "$routes" ]; then
  echo "FATAL: no GPXFile: entries found in /app/meshtk.yaml -- assertion would pass vacuously" >&2;
  exit 1;
fi
```

and names the missing routes when one does not resolve. Its output appearing in
this build log is what makes it evidence rather than decoration.

## Pre-dispatch merge-scope guard (T-69-07-11)

Recorded verbatim, immediately before dispatching the deploy:

```
$ gh pr list --state open --search "Release in:title" --json number,title,headRefName
[]
```

Empty: **no open run.mqtt Release PR**, so buildpub's own auto-merge of #1107
succeeded and nothing was left for `deploy.yml` to merge. The deploy was
dispatched with `pr_number=skip`.

**The guard was load-bearing, not ceremonial.** At 15:34:55Z — while this plan's
deploy was mid-rolling-replace — an unrelated workstream dispatched its own
deploy for PR **#1109** ("Release v20260730.1129", a run.human version bump).
Had this plan used `pr_number=latest`, deploy.yml would have resolved to the
newest open `Release*` PR and `--admin`-squash-merged it. Whether #1109 was
already open at 15:29:46Z or opened seconds later, the race existed and
`pr_number=skip` is what removed it. T-69-07-11 was a live risk here, not a
theoretical one.

## deploy

```
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true
```

| Item | Value |
|------|-------|
| Run id | **`30556951618`** |
| Conclusion | **`success`** |
| Window | 2026-07-30T15:29:46Z → 15:32:13Z |
| Merge job | **skipped** (`if: inputs.pr_number != 'skip'`) — deploy.yml merged nothing |
| Jobs that ran | Terragrunt Apply ✓, Invalidate Cache ✓, Summary ✓ |

`git status --porcelain` is empty and no `*.tfstate*` artifact exists anywhere in
the tree: no local apply happened.

### Concurrent unrelated deploy, recorded for attribution honesty

`deploy.yml` run `30557385386` (`PR:1109`, 15:34:55Z → 15:37:35Z, success) ran
during this plan's rolling replace. It is a **run.human** release: PR #1109
touches only `apps/run.human/nginx/VERSION`, `apps/run.human/webapp/VERSION`,
`infra/terraform/live/site/services/run.human/VERSION.app` and `VERSION.nginx`.
It registered no new `run-mqtt-use1-dc34` task definition — the family has
exactly two live revisions, `119` and `69`, and `119` was registered at
15:30:45Z by run `30556951618`. Nothing in this plan's evidence is attributable
to it.

## The real drain gate

`aws ecs wait services-stable` was NOT used as the gate. `deploy.yml` reported
success at **15:32:13Z**; the old task was still `RUNNING` at 15:34:21Z and did
not reach `STOPPED` until **15:41:35Z** — more than nine minutes after CI went
green, and it held every long-lived MQTT TCP connection for that whole window.
Any post-deploy claim made on the CI conclusion alone would have been wrong.

```
15:32:31Z old task lastStatus=RUNNING
...
15:34:37Z old task lastStatus=DEACTIVATING
...
15:40:38Z old task lastStatus=STOPPING
15:41:25Z old task lastStatus=DEPROVISIONING
15:41:41Z old task lastStatus=STOPPED
```

| Item | Value |
|------|-------|
| Old task `lastStatus` | **`STOPPED`** |
| `stoppedAt` | **2026-07-30T15:41:35.479Z** |
| `stoppedReason` | `Scaling activity initiated by (deployment ecs-svc/1637086347952626779)` |
| Old task definition | `run-mqtt-use1-dc34:118` |

## Post-deploy service state

| Item | Value |
|------|-------|
| Service task definition | **`run-mqtt-use1-dc34:119`** |
| `run-mqtt-meshtk` image | `427284555693.dkr.ecr.us-east-1.amazonaws.com/dc34-run-mqtt-meshtk:`**`v0.0.76`** |
| `run-mqtt-ghosts` image | same tag `v0.0.76` (shares the meshtk image) |
| Deployments | exactly **1**, `PRIMARY`, `rolloutState=COMPLETED`, `1/1` |
| `desiredCount` / `runningCount` | `1` / `1` |
| New task | **`3ba2d8ca22934c47826dc673de0a3614`** — `RUNNING`, `HEALTHY`, started 15:33:57.496Z |
| **New log stream** | **`meshtk/run-mqtt-meshtk/3ba2d8ca22934c47826dc673de0a3614`** |

Every count in Task 3 is scoped to that stream with `--log-stream-names`.

No probe was run in this task: PRE was captured in Task 1 and POST belongs to
Task 3.
