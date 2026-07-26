# Post-flash Welcome DM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every successful flash+configure+registration sends the radio a welcome PKI DM from `!dc340001`, immediately plus a proof-of-life re-flush.

**Architecture:** run.human's internal registration route enqueues a `MeshWelcomePending` item (same DDB partition as OTP, distinct sk prefix); the meshtk poller's List widens to the whole partition and dispatches by sk prefix; welcome sends reuse the OTP send path then hand the envelope to the fleet's pending store for proof-of-life re-publish.

**Tech Stack:** run.human ElectroDB + vitest; meshtk Go (upstream `~/working/meshtk`, branch `feat/welcome-dm` already cut).

**Spec:** `docs/superpowers/specs/2026-07-26-flash-welcome-dm-design.md`

## Global Constraints

- Same repo rules as the OTP feature (2026-07-25 plan): meshtk code upstream → vendor-sync commit into `apps/run.mqtt/meshtk`; deploy only via `deploy.yml`; Node ≥22.12 for run.human vitest.
- LOCKED keys: welcome sk = `"$meshwelcomepending_1#nodeid_<nodeId>"` in partition pk `"$run#queue_otp"`; parity fixture `!433d1cec` / 1128078572. OTP item contract unchanged.
- Registration enqueue is best-effort (try/catch, never fails the registration response).

---

### Task 1: run.human `MeshWelcomePending` + registration enqueue

**Files:**
- Create: `apps/run.human/webapp/src/entities/mesh-welcome-pending.ts` — entity `MeshWelcomePending` v1 service `run`; attributes `queue` (const "otp", pk composite), `nodeId` (sk composite), `nodeNum`, `message`, `userId`, `attempts` (default 0), `createdAt` (default now); helpers `enqueueWelcome({nodeId,nodeNum,message,userId})` (upsert) and `meshWelcomePendingKeyFor(nodeId)` (`.get(...).params().Key`) — mirror `mesh-otp-pending.ts` exactly.
- Test: `apps/run.human/webapp/src/entities/__tests__/mesh-welcome-pending-key-parity.test.ts` — asserts pk `"$run#queue_otp"`, sk `"$meshwelcomepending_1#nodeid_!433d1cec"` for fixture.
- Modify: `apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts` — after the MeshRadio upsert/update succeeds (both create and re-flash paths), render `Welcome to defcon.run, ${displayName || "runner"}! Your radio is configured and on the mesh. Reply hi to any rabbit 🐇 or visit run.defcon.run` (the route already resolves the RunUser — reuse its displayName variable; check the file for the exact name) and `try { await enqueueWelcome(...) } catch (e) { console.error(...) }`.

Steps: failing parity test → entity → pass → wire route → `npx vitest run src/entities` all green → commit `feat(human): enqueue welcome DM on radio registration`.

### Task 2: meshtk — widen List, welcome poller path, pending-store handoff (upstream)

**Files (in `~/working/meshtk`, branch `feat/welcome-dm`):**
- Modify: `internal/otpqueue/types.go` — add `welcomeSKPrefix = "$meshwelcomepending_1#nodeid_"`, `WelcomeItem{NodeID,NodeNum,Message,UserID,Attempts,CreatedAt}` (dynamodbav tags identical style), extend `Store` with `ListWelcome`… NO — keep one call: change `List(ctx) ([]Item, []WelcomeItem, error)`; add `DeleteWelcome(ctx, nodeID)` and `BumpWelcomeAttempts(ctx, nodeID, n)` composing the welcome sk.
- Modify: `internal/otpqueue/store.go` — Query drops the sk begins_with condition (pk only); classify rows by sk prefix (`strings.HasPrefix`); unknown prefixes skipped. Parity test adds `TestWelcomeKeyParity` for the sk composition.
- Modify: `internal/app/fleet/otpsend.go` — `otpSendDeps` gains `SendWelcome(item otpqueue.WelcomeItem, pubKeyHex string) error`; `processOtpQueue` handles welcome items with the same age/attempts/keyless gates (counters: `welcome` added to the summary line). Prod impl `fleetOtpDeps.SendWelcome`: build envelope once via `BuildPKIMessage(sender, to, TEXT_MESSAGE_APP, []byte(item.Message), priv, pub)`; `PublishEnvelopeBytes` on the sender's gateway PKI topic; on success `d.f.queuePendingReply(0, sender, item.NodeNum, topic, "welcome", envelope)` — proof-of-life re-flush with byte-identical envelope.
- Tests: `internal/otpqueue/store_test.go` mixed-partition classification (otp + welcome + unknown sk in one Query page); `internal/app/fleet/otpsend_test.go` welcome cases (success → SendWelcome+DeleteWelcome, no MarkRadioCodeSent; failure → BumpWelcomeAttempts; reap on age/cap).

Steps: failing tests → implement → `go test ./... && go build ./...` green → commit → push → PR to whereiskurt/meshtk → merge → pull main.

### Task 3: vendor-sync, PRs, release, deploy, verify

- rsync upstream → `apps/run.mqtt/meshtk` (same excludes as 2026-07-25), `go test ./internal/otpqueue/ ./internal/app/fleet/` inside the vendored tree, commit vendor-sync.
- Add Done-step copy line: append `"flash.done.welcomeHint": "Watch your radio — a welcome message from DEF CON 34 MeshMap is on its way."` to run.flash `copy-snapshot.json` and render it in `components/done/done-step.tsx` success block via `t("flash.done.welcomeHint")`. (Ship with run.flash only if releasing flash too — otherwise fold into the same PR and release all three apps.)
- PR defcon repo → merge → release `--apps run.human,run.mqtt,run.flash --regions use1 --pr` → deploy.yml use1 with the Release PR → verify: ghosts log `otp: delivery poller started`, then flash-UAT (Kurt) sees the welcome DM; poller line `welcome=1`.

## Self-Review Notes
- Spec coverage: queue entity+enqueue (T1), classification+send+pending handoff (T2), copy hint+ship (T3). OTP contract untouched (classification is additive; existing sk-prefixed Query replaced by pk Query + prefix dispatch — OTP items still parsed identically, covered by existing tests).
- Names consistent: `enqueueWelcome` / `WelcomeItem` / `SendWelcome` / `DeleteWelcome` / `BumpWelcomeAttempts` used identically across tasks.
