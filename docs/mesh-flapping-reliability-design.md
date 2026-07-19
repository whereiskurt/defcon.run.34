# Mesh Flapping Reliability — Design Spec

**Status:** APPROVED, ready to implement · **Date:** 2026-07-19 · **Target:** run.mqtt / meshtk, region use1

> **For the implementing session:** this doc is self-contained. Also read the memory file
> `project_ghost_reply_drowning_resolution` (indexed in `MEMORY.md`) for the full diagnostic
> history, the ghost-key derivation recipe, and deploy landmines.

---

## 1. Context — why this exists

Established live on 2026-07-19 while debugging "ghost chatbot replies never reach my device":

- The iOS Meshtastic app (`MeshtasticAppleMqttProxy`) **reconnects roughly every 60s** (measured:
  min 18s / median 60s / max 286s), and does so **abruptly — zero clean `DISCONNECT` packets**
  across 15 reconnects. This is iOS backgrounding of the BLE↔MQTT proxy.
- mosquitto is **not** the cause: `max_keepalive 65535` (no enforcement).
- mosquitto runs **`persistence false`**, and Meshtastic publishes **QoS0**. Therefore **any
  downlink published while a radio is between reconnects is silently dropped** — there is no queue.

Two user-visible consequences:

1. **Node loss on reconnect.** A reconnecting (or freshly wiped) radio starts blind and must
   re-catch each node's next NODEINFO beacon, which is minutes apart. Under channel load it may
   never complete the fleet.
2. **One-shot chatbot replies vanish.** Proven server-side: dt and mudge both logged
   `Successfully sent PKI reply ... to 1129943268` yet the messages never displayed on the device.
   ricky's replies *do* display — because ricky emits ~60 messages over 3+ minutes, so some land
   inside a connected window. Single-shot repliers lose their one packet to a gap.

Two contributing server-side causes were **already fixed** earlier the same day and are **not**
part of this spec:

| Fix | Version | Effect |
|---|---|---|
| Sim scale-down (killed nyc/jpn, pack 25→5 @30s) | v0.0.37 | channel load ~4.2 → ~1.3 msg/s; device sees all nodes |
| Proxy rate-limiter disabled (allow-all) | v0.0.38 | reconnect interval ~31s → ~60s |

The **residual ~60s flapping is iOS-app-side and cannot be fixed from the server.** This spec
therefore reduces the *impact* of flapping rather than trying to eliminate it.

## 2. Goals / non-goals

**Goals**

1. A reconnecting radio **instantly re-learns the whole fleet** (identities + pubkeys) — Part 1.
2. A one-shot chatbot reply **survives a ~60s disconnect gap** — Part 2.
3. Every requester (not just the first) can get ricky's lyric reply — Part 3.

**Non-goals (explicitly out of scope)**

- Eliminating the flapping itself (that's device-side: direct-WiFi MQTT so firmware owns the link).
- Retaining **real attendees'** NodeInfo (would need a republish sidecar — deferred).
- Re-enabling the nyc/jpn sim fleets (separate change, needs a load re-test).
- The iOS out-of-order message display (client-side cosmetic).
- Restoring the proxy rate limiter (post-con task).

## 3. Part 1 — Retain fleet NodeInfo

**Change:** in `~/working/meshtk/internal/mqtt/publish.go`, function `PublishNodeInfo`, flip the
retain flag on its single publish call (currently line ~81):

```go
token := c.client.Publish(topic, 0, false, envelopeBytes)   // before
token := c.client.Publish(topic, 0, true,  envelopeBytes)   // after — retain NodeInfo
```

**Why this works.** MQTT stores the last `retain=true` message **per topic** and replays it to any
client the moment it subscribes. Meshtastic sends NodeInfo, Position and text all to the *same*
topic `msh/US/2/e/dc.run/!<node>` — but a `retain=false` publish **does not overwrite** the
retained value. So NodeInfo stays retained while live Position/text continue to flow normally. Any
radio subscribing to `msh/US/2/e/dc.run/+` receives every fleet node's identity **immediately**,
with no beacon wait.

**Must NOT change** — the other three publish calls in this file stay `false`:

| Line (approx) | Function | Retain |
|---|---|---|
| 81 | `PublishNodeInfo` | **true** ← the only change |
| 168 | `PublishMessageEncrypted` (channel text) | false |
| 255 | `PublishACK` | false |
| 416 | `PublishPKIMessage` | false |

> **Security rule — non-negotiable:** PKI / direct-message traffic must **never** be retained.
> Retaining a one-to-one DM would replay private messages to every future subscriber.
> Position and MapReport also stay `false` (stale positions are worse than none, and retaining
> them would overwrite the retained NodeInfo on the shared topic).

**Staleness / cleanup.** mosquitto runs `persistence false`, so the retained store is in-memory and
is cleared whenever the broker restarts — which happens on every deploy. A node removed from the
fleet self-clears at the next deploy. No explicit "clear with empty retained payload" logic in v1
(YAGNI); revisit only if stale ghosts are observed persisting.

## 4. Part 2 — One-shot reply retry

**Change:** in `~/working/meshtk/internal/app/fleet/cmd.go`, the **one-shot** chatbot reply paths
re-send the same reply **3 times total, spread over ~90s** (t=0, +30s, +60s).

Call sites to make reliable (all currently call `sendPKIReply` once):

- `otp_failure` else-branch (~line 453) — the `for _, reply := range chatBot.Message` loop
- `otp_success` branch (~line 423)
- the `"OpenAI key not configured"` fallback (~line 415)

**Implementation shape:** add a helper (e.g. `sendPKIReplyReliable`) that wraps `sendPKIReply` and
performs the spread re-sends in a **non-blocking goroutine**, so the packet handler is never
stalled for 90s. Point only the one-shot call sites at it.

> **Must NOT retry `handleLyricsChat` (ricky).** It already emits ~60 messages per request; a 3×
> retry would produce ~180 and flood the channel — re-creating the drowning problem we just fixed.
> Lyrics stay single-send per line.

**Rationale.** This is precisely why ricky's replies survive and dt/mudge's do not: volume beats the
gap. 3 sends over 90s covers ~1.5 flapping cycles at the measured 60s median.

**Accepted trade-off:** on a healthy link the user sees the reply up to 3 times. Duplicates are
strictly better than silence, and the retry count is a single constant we can tune down later.

## 5. Part 3 — Fix ricky lyrics dedup key

`handleLyricsChat` (~line 472) guards with:

```go
count, exists := n.LyricsResponded[toFleetIdx][to]   // `to` is the GHOST, not the requester
```

Because the key is the **ghost**, only the **first requester per fleet lifetime** ever receives the
lyric reply — everyone after is silently skipped until the fleet restarts. At a con that means one
attendee gets it and nobody else.

**Change:** key the map by **`from`** (the requesting radio) so each requester is deduped
independently.

## 6. Build source of truth — LANDMINE

`apps/build.sh` → `resolve_meshtk()`: CI **clones github `whereiskurt/meshtk` main**, then
**overlays the repo-tracked files** under `apps/run.mqtt/meshtk/` on top.

Tracked `.go` overlays (these, and only these, require a **dual edit** in both repos):

```
apps/run.mqtt/meshtk/internal/app/server/inspect.go
apps/run.mqtt/meshtk/internal/app/server/proxy.go
apps/run.mqtt/meshtk/internal/app/server/rules.go
apps/run.mqtt/meshtk/internal/embedded/gpx/embedded.go
```

**`internal/mqtt/publish.go` and `internal/app/fleet/cmd.go` are NOT overlays.** They come from the
meshtk clone. **Edit `~/working/meshtk` on `main` ONLY.** Do not create monorepo copies of them —
that would silently pin the build to a stale file.

## 7. Execution runbook

1. `cd ~/working/meshtk`; confirm on `main`; `git pull`.
2. Implement Parts 1, 2, 3.
3. Gates — all must pass: `go build ./cmd/meshtk.go`, `go vet ./...`, `go test ./...`.
   Add unit tests: NodeInfo publish uses retain=true while the other publishes stay false; the
   one-shot retry emits the expected count/spacing and lyrics do **not** retry; lyrics dedup keys
   by requester.
4. Commit + push `~/working/meshtk` **main** (`whereiskurt/meshtk`).
5. Build (bumps VERSION, auto-merges its Release PR):
   `gh workflow run buildpub.yml --repo whereiskurt/defcon.run.34 --ref main -f apps=run.mqtt -f regions=use1 -f deploy=false`
6. Wait for success, then deploy:
   `gh workflow run deploy.yml --repo whereiskurt/defcon.run.34 --ref main -f region=us-east-1 -f pr_number=skip`
7. Wait for the ECS rollout to finish — cluster `app-use1-dc34`, service `run-mqtt-use1`. Both the
   old and new fleets run mid-rollout; wait until only **one** deployment remains.
8. Run the verification in §8, then hand back for device-side confirmation.

AWS for all checks: `--profile dc34-application --region us-east-1` (SSO expires ~hourly).
If a PR merge is blocked by branch protection: `gh pr merge <n> --squash --admin`.

## 8. Verification (server-side, no device required)

**Part 1 — retained NodeInfo arrives instantly on subscribe.** Retained messages are delivered at
SUBSCRIBE time, so they land in the first moment of a fresh connection, before any live beacon:

```
mosquitto_sub -h mqtt.defcon.run -p 8883 --tls-use-os-certs \
  -u ghosts -P "$(aws ssm get-parameter --profile dc34-application --region us-east-1 \
     --name /dc34/secrets/use1/mqtt/ghosts-password --with-decryption --query Parameter.Value --output text)" \
  -W 5 -t 'msh/US/2/e/dc.run/+' -F '%t'
```

Expect an immediate burst of ~one message per fleet node (~17 sims + 10 ghosts) within the first
second. Before the change, a 5s window would return only the handful of nodes that happened to
beacon. Compare against the fleet size.

**CRITICAL security check — PKI must NOT be retained:**

```
mosquitto_sub ... -W 5 -t 'msh/US/2/e/PKI/#' -F '%t'
```

Must return **nothing** in the first instant (no retained DMs). If retained PKI messages appear,
**roll back immediately** — that leaks private messages to new subscribers.

**Part 2 — retry spread.** Log group `/ecs/run-mqtt-ghosts-run-mqtt-use1-dc34`, filter
`"Successfully sent PKI reply"`. After a DM to a one-shot ghost (goldstein/dt/mudge/condor), the
same reply text should appear **3×, ~30s apart**. Confirm ricky's lyrics did **not** multiply.

**Part 3 —** covered by unit test; optionally confirm two different requester node numbers each
receive lyrics.

> Log-reading notes: ghosts run `-v debug`. Successful-decrypt lines are TRACE and therefore
> invisible — rely on the INFO `Successfully sent PKI reply`. The repeated
> `recipient node ... not found in nodeDB` warnings are **normal** multi-fleet fan-out noise
> (every non-owning ghost NACKs each PKI packet); filter them out.

## 9. Rollback

Revert the meshtk commit on `main`, re-run buildpub + deploy. Retained NodeInfo clears by itself on
the broker restart that the deploy causes (`persistence false`).

## 10. Landmines

- **Immutable-tag race:** after deploying, confirm the running task definition's image tag matches
  the build you just produced (`aws ecs describe-task-definition`).
- Each deploy restarts the fleet, so every radio relearns its NodeDB — expect a brief empty period.
- **Device-side confirmation needs the physical radio.** Finish the server-side verification, then
  stop and hand back; do not claim end-to-end success without a device check.

## 11. Follow-ups (not this change)

- Re-enable the nyc/jpn sim fleets at a **calm** cadence (~30s, not the original 2–3s) once retain
  is confirmed, with a load re-test.
- Retain real attendees' NodeInfo via a republish sidecar.
- Restore the proxy rate limiter after the con.
- Investigate why a hand-built synthetic PKI packet does not display on-device while genuine ghost
  replies do (crypto and topic were proven correct; residual packet-structure difference).
