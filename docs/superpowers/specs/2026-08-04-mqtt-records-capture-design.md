# MQTT Records Capture, Self-Serve Access, and nodes.json Snapshot

**Date:** 2026-08-04
**Status:** Design approved, not yet planned or built
**Repos touched:** `whereiskurt/meshtk` (capture, snapshot), `defcon.run.34` monorepo (terraform, run.human)

---

## 1. Context

Debugging a radio that reconnected every 60 seconds on 2026-08-04 required hand-running
CloudWatch Logs Insights queries across five log groups. The data needed to answer
"did my message land, and did anything come back" existed, but only in CloudWatch — with a
retention window, no structure, and no way for anyone but an operator with AWS credentials
to reach it.

This design captures MQTT records durably to S3 and puts them in admins' hands without an
AWS console.

### Goals

1. **Debug** — answer "what happened to this radio" from stored records, self-serve.
2. **Durable** — records outlive CloudWatch retention and the 30-day log-bucket expiry.
3. **Raw data for admins** — Shannon and other operators fetch records directly.
4. **Dashboard-ready** — structured enough that a future `mqtt.defcon.run` dashboard
   (replacing the legacy 564-line `index.html`) can consume it without writing a parser.

### Non-goals

- The dashboard itself. That is a separate project consuming this one's output.
- Capturing mosquitto or ghosts container output. Proxy records only.
- Real-time streaming. This is a batch archive, flushed on a timer.

---

## 2. Findings that shaped this design

All four were discovered while investigating, and all four are load-bearing.

### 2.1 S3 log shipping writes to the wrong bucket

meshtk uploads inspector logs to the **hardcoded default** bucket:

```
s3://meshtk-blocklist-20250101/meshtk/blocklist/2026/08/04/blocklist.20260804.094632.log
```

The terraform-managed `mqtt-logs-use1-dc34-80a6b349` has **0 objects**. So does
`mqtt-blocklist-use1-dc34-80a6b349`.

**Root cause.** `pkg/config/config.go` binds env vars with only
`viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))` + `viper.AutomaticEnv()` — no
explicit `BindEnv`. The struct field `S3BucketName` therefore binds to
`MESHTK_S3BUCKETNAME`. The ECS task definition sets `MESHTK_S3_LOGS_BUCKET`, which maps to
a config key that does not exist, so the default silently wins.

This is the same failure mode already documented in `service.hcl` for
`MESHTK_NODEDB_PATH` vs `MESHTK_NODEDBPATH`. All three `MESHTK_S3_*` vars are dead this
way. It also explains why log objects are named `blocklist.*.log` under a `blocklist/`
prefix — logs reuse the blocklist config fields.

**Consequence for this design:** any new bucket env var added the same way will silently
not bind. Fixing the binding is a prerequisite, not a nice-to-have.

### 2.2 Downlink deliveries are not in the S3 capture

`DOWNLINK` lines go to `n.Config.Log` (stdout → CloudWatch). The `action=ALLOW` /
`SESSION_*` decision lines go to `InspectorLogger` (file → S3). The 1,646-vs-0 downlink
comparison that proved a channel was dead **would not exist** in the archive as built.

### 2.3 Downlink fan-out is 9.4x, and it is not a bug

Measured over 180 seconds of production traffic:

| metric | value |
|---|---:|
| DOWNLINK lines | 4,766 |
| distinct packet ids | 508 |
| distinct client sockets | 16 |
| **(packet, client) pairs delivered more than once** | **0** |

Every line is a distinct packet→client delivery — normal broadcast fan-out, not duplicate
delivery. Recipients per packet ranged 1–15, with the large majority at 8–12
(9 recipients: 210 packets; 10: 182; 12: 29). The redundancy is in the *logging shape*, not
the behaviour, so aggregating one record per packet with a recipient list preserves the
full signal at 1/9th the volume.

### 2.4 Volume is small only if downlinks are aggregated

| stream | per day |
|---|---:|
| uplink + session | ~8 MB |
| downlink, one line per delivery | ~350 MB |
| downlink, aggregated per packet | ~37 MB |
| **total, aggregated + gzipped** | **~5 MB** |

Raw downlink capture would be ~44x the uplink volume — roughly 10.5 GB/month.
Aggregated and compressed it is ~150 MB/month.

---

## 3. Component A — Capture

### 3.1 Storage: a dedicated bucket

New bucket `mqtt-records-{region}-{site}-{suffix}`, **not** a prefix inside `mqtt-logs`.

The existing `aws_s3_bucket_lifecycle_configuration.mqtt_logs` rule has **no filter**, so
it expires the entire bucket at 30 days. Anything written there dies on day 31, silently
defeating the durability goal. A separate bucket also means:

- Its own lifecycle (**no expiry** — records are kept indefinitely) without editing a live
  rule that currently guards ops logs.
- IAM for the self-serve reader is "read this bucket" rather than a prefix-scoped policy
  that is easy to widen by accident.
- The presigned-URL surface covers exactly the archive and nothing else.

Public access block: all four flags on, as with the existing buckets.

### 3.2 Layout: Hive-partitioned

```
s3://mqtt-records-use1-dc34-<suffix>/
  dt=2026-08-04/hour=15/meshtk-<task6>-<seq>.jsonl.gz
```

`dt=` / `hour=` is the layout Athena and most dashboard tooling partition-prune on, so
"Aug 4, 15:00–16:00" reads one object instead of scanning the archive. The short task id in
the filename prevents two concurrent tasks colliding on the same key.

**Partition is chosen from the record's own timestamp, not from flush time** — a flush
spanning 15:59→16:01 writes two objects into the correct partitions rather than misfiling
an hour of data.

### 3.3 Record model: newline-delimited JSON, gzipped

Three `kind`s sharing a common envelope. Payloads are **retained** (decided explicitly;
see §6.1).

**Session** — from the `SESSION_START`/`SESSION_END` pair added in meshtk PR #37:

```json
{"ts":"2026-08-04T14:42:23.881Z","kind":"session","event":"start","ip":"10.0.1.27:21120",
 "client_id":"MeshtasticAppleMqttProxy-!d50b630d","username":"e9ced815b0ee",
 "keepalive_s":60,"read_timeout_s":90}
{"ts":"2026-08-04T14:43:24.912Z","kind":"session","event":"end","ip":"10.0.1.27:21120",
 "client_id":"MeshtasticAppleMqttProxy-!d50b630d","reason":"client_eof","duration_s":61.0}
```

**Uplink** — one per inspected packet:

```json
{"ts":"2026-08-04T14:43:24.026Z","kind":"uplink","decision":"allow","mqtt_type":"PUBLISH",
 "client_id":"MeshtasticAppleMqttProxy-!d50b630d","username":"e9ced815b0ee",
 "topic":"msh/US/2/e/dc.run/!d50b630d",
 "mesh":{"type":"TEXT_MESSAGE_APP","from":"d50b630d","to":"ffffffff",
         "payload_hex":"53686f7574206f757420696620796f75e280997265..."}}
```

**Downlink** — aggregated, one per packet:

```json
{"ts":"2026-08-04T14:02:07.112Z","kind":"downlink","packet_id":"3bf7cf81","from":"e8d9f26c",
 "topic":"msh/US/2/e/dc.run/!e8d9f26c","recipient_count":10,
 "recipients":["MeshtasticAppleMqttProxy-!d50b630d","!c40abca0","..."]}
```

`recipients` carries **client_id, not socket address**. Socket addresses are ephemeral and
meaningless a year later without joining against session records; client_id is
self-describing, which is the point of a durable archive.

**Meta** — emitted at the head of each flushed object:

```json
{"ts":"...","kind":"meta","dropped_since_last_flush":0,"task":"a1b2c3","seq":41}
```

### 3.4 Records are emitted, never scraped

Records come from a dedicated `Recorder` interface called at the same sites that log
today. They are **not** parsed back out of log text.

The log line is a human artifact that has already drifted once — `mqtt_type=PubackPacket`
leaks a Go type name into a field that otherwise carries MQTT packet names. The record is a
contract with golden tests. They share call sites, never a format.

| record | emission point | current state |
|---|---|---|
| `session` | `sessionLog.logStart` / `logEnd` | exists (PR #37) |
| `uplink` | `WriteDecisionLog` (ALLOW/BLOCK) | exists |
| `downlink` | the `DOWNLINK` sites in `proxy.go` / `proxy_v5.go` | exists as `Debugf` |

Both protocol paths must emit. Instrumenting only 3.1.1 would leave Meshtastic-Android and
the meshmon tools invisible — the same blind spot, differently shaped.

### 3.5 Pipeline

```
proxy hot path ──> Recorder.Record(rec)          [non-blocking send]
                          │
                          ▼  buffered chan (4096)
                   writer goroutine
                     ├── downlink aggregator (keyed by packet_id, ~2s window)
                     └── gzip ──> temp file, partitioned by record's OWN ts
                                        │
                     flush timer (15 min, and at each hour boundary)
                                        ▼
                              S3 PutObject  dt=…/hour=…
```

**The hot path must never block.** `Record()` does a non-blocking send. If the buffer is
full it **drops and counts**, and the count is written into the next flushed object as a
`meta` record. At con scale, stalling the broker to guarantee a log line is the wrong
trade — but a silent gap is worse than either. A visible gap can be reasoned about.

### 3.6 Config binding fix

Add explicit `viper.BindEnv` calls so underscore-separated names resolve. This
simultaneously repairs `MESHTK_S3_LOGS_BUCKET`, `MESHTK_S3_BLOCKLIST_BUCKET`, and
`MESHTK_S3_SNAPSHOT_BUCKET`, and lets the new `MESHTK_RECORDS_BUCKET` work at all.

Without this, records silently go nowhere — exactly as logs do today.

New configuration:

| var | default | meaning |
|---|---|---|
| `MESHTK_RECORDS_ENABLED` | `false` | Master switch. **Off by default** so the recorder ships dark and is enabled only once the bucket and IAM are in place (see §8). |
| `MESHTK_RECORDS_BUCKET` | *(empty)* | Destination bucket. Empty with `ENABLED=true` is a startup error, not a silent no-op. |
| `MESHTK_RECORDS_FLUSH_MINS` | `15` | Flush cadence; also flushes at each hour boundary regardless. |
| `MESHTK_RECORDS_BUFFER` | `4096` | Channel depth before records are dropped-and-counted. |

An empty bucket with the feature enabled must **fail loudly at startup**. The entire
premise of §2.1 is that a silent fallback cost months of misrouted logs; the new path must
not be able to repeat it.

### 3.7 Sizing

Task is `task_cpu = 1024`, `task_memory = 2048`. Container allocation:

| container | CPU | memory |
|---|---:|---:|
| mosquitto | 64 | 128 |
| **meshtk** | **96** | **192** |
| nginx | 64 | 128 |
| ghosts | 128 | 256 |
| guardrails | 512 | 1024 |
| allocated | 864 | 1728 |
| **unallocated slack** | **160** | **320 MB** |

Measured utilisation over 12 h (`AWS/ECS`, `run-mqtt-use1`, % of task reservation):
CPU **avg 1.6% / max 6.0%**; memory **29.6% flat** (~606 MB of 2048 MB).

The recorder adds ~3–5 MB steady state (4096-entry channel ≈1.6 MB, gzip deflate state
≈0.6–1.2 MB, aggregator ≈KB) and well under one CPU unit.

**Change: meshtk memory 192 → 320 MB, `memory_reservation` 96 → 160. CPU unchanged at 96.**

The extra headroom is so a stalled S3 endpoint can back up buffers without OOM-killing the
container that *is* the broker. It draws 128 MB from the 320 MB of unallocated slack.
`task_cpu`/`task_memory` do **not** change, so the Fargate tier is unchanged and the
"1024 CPU requires ≥2048 memory" ordering constraint is not touched. It is still an
`ecs-task` apply.

**Caveat:** Container Insights is not enabled on `app-use1-dc34`, so 29.6% is task-wide
across five containers. meshtk's individual share is inferred, not measured.

---

## 4. Component B — Admin self-serve

### 4.1 Route and gating

Lives at **`/user/mqtt-records`** in run.human, following the `qradmin` twin-route
precedent: non-core admin groups deliberately get nothing under `/admin/*` or
`/api/admin/*` because edge/WAF rules may wall that area off. One route that works for
every group.

```ts
export const RECORDS_GROUPS = ADMIN_GROUPS;  // admin, runadmin
```

`gpxadmin` was considered and **dropped** — it is not a group run.auth issues today, and
Shannon is being granted `runadmin` instead. Keeping the constant as its own named export
(rather than using `ADMIN_GROUPS` inline) means a future third group is a one-line change
at a single site.

### 4.2 Operations

```
GET  /user/mqtt-records?dt=2026-08-04   → ListObjectsV2 under dt=… → keys + sizes + counts
POST /user/mqtt-records/link {key,ttl}  → validate → presign(GET) → audit row → URL
```

### 4.3 Key validation is security-critical

The mint endpoint must never sign an arbitrary key — that would turn an admin route into
"presign me any object in this account". Accepted keys must match exactly:

```
^dt=\d{4}-\d{2}-\d{2}/hour=\d{2}/[A-Za-z0-9._-]+\.jsonl\.gz$
```

No traversal, no prefixes, no wildcards. This gets dedicated tests.

### 4.4 Audit

Every mint writes a row **before** returning the URL: who minted it, which key, what TTL,
when. Since links are intended to be shared onward, attribution at mint time is the only
control that survives forwarding — a leaked link is traceable to whoever minted it.

### 4.5 TTL constraint

Presigned URLs signed with **ECS task-role credentials expire when those temporary
credentials expire**, regardless of the requested TTL. "Share this for a week" is not
achievable this way.

- Default TTL: **15 minutes**
- Reliable ceiling: **~1 hour**
- Longer sharing requires a different signing identity (a dedicated long-lived key, which
  this design recommends against) or re-minting.

### 4.6 IAM

run.human's task role gets `s3:ListBucket` + `s3:GetObject` scoped to the records bucket
only. This is precisely why §3.1 put records in their own bucket.

---

## 5. Component C — nodes.json snapshot and restore

### 5.1 Problem

`nodes.json` is written to `/var/www/html/nodes.json` on an ephemeral container filesystem
by the `meshobserv` process, which runs under supervisord inside the **`run-mqtt-nginx`**
container (`meshobserv -c /app/meshtk.yaml nodeinfo announce`).

There is **no snapshot or restore code in meshtk**. `MESHTK_S3_SNAPSHOT_BUCKET` is wired in
the task definition but points at a feature that was never built; no snapshot objects exist
in any bucket.

So a task restart wipes `nodes.json` to zero and it rebuilds only from radios that
transmit.

### 5.2 Measured cost

In a 15-minute window, **9 distinct nodes transmitted anything** — against **81 entries**
in `nodes.json`. All nine were real radios; zero ghost/rabbit nodes appeared as uplink
senders, so the loss is not offset by the simulated fleet repopulating quickly.

A restart therefore takes the map from 81 pins to ~9 within 15 minutes, with the remainder
trickling back over hours. Anything powered off, out of range, or asleep never returns
until it next transmits.

The failure is **silent** — the map simply gets sparse, and nothing alarms.

### 5.3 Design

- **Periodic snapshot:** meshobserv writes `nodes.json` to
  `s3://mqtt-records-.../snapshots/nodes/nodes-<ts>.json` on a timer (default 5 min) and on
  graceful shutdown.
- **Restore on boot:** on startup, if the local `nodes.json` is absent or empty, fetch the
  newest snapshot and seed from it before subscribing.
- **Staleness is handled at render, not by amnesia.** Restoring everything is safe because
  consumers already carry `lastSeen`; a stale pin is filtered by the renderer rather than by
  wiping the database. This keeps the one genuine upside of the current behaviour
  (nodes that left the con age out) without paying for it with a blank map after every
  deploy.
- Snapshots share the records bucket under a distinct prefix, so they inherit the same
  no-expiry lifecycle and the same IAM.

### 5.4 Operator reset: write `{}` to the snapshot

The snapshot doubles as the reset control. An operator who writes an empty JSON object to
the snapshot key clears the node database.

**The naive version of this does not work**, and the reason is worth stating so nobody
"simplifies" it back later. `initNodeDb` writes the local file every 5 s and `flushNodeDb`
writes again on shutdown. If restore-from-snapshot only happened at boot, then an operator
writing `{}` and restarting would have their `{}` overwritten by the outgoing task's
snapshot before the new task ever read it. The reset would silently never happen.

So the snapshot tick performs a **read-before-write**:

1. `GET` the current snapshot.
2. If it decodes to an **empty object** and the in-memory DB is **non-empty**, treat it as
   an operator reset request: clear the in-memory DB and the local file, and **skip this
   cycle's `PUT`** so the `{}` stays authoritative for any concurrently-booting task.
3. Otherwise `PUT` the current DB as normal.

Consequences, all intentional:

- The reset takes effect **without a restart**, within one snapshot interval (≤5 min).
- The boot path and the tick path agree: restoring from `{}` also yields an empty DB.
- It converges. After a reset the DB is empty, so the next tick sees "remote empty, local
  empty", does not re-trigger, and resumes normal snapshotting as traffic repopulates.
- A `GET` failure is **fail-safe**: no reset is inferred, a warning is logged, and the
  `PUT` still proceeds so a transient S3 error cannot cost a backup.
- A snapshot that is legitimately `{}` because no nodes have been seen makes the reset a
  no-op, which is harmless.

The only residual race is an operator writing `{}` in the same instant as a `PUT`, which
loses the request; re-issuing it works. This is acceptable for a manual operator action.

---

## 6. Decisions made

### 6.1 Payloads are retained

Records keep decrypted message payloads as hex. This maximises debugging and archive value
and was chosen explicitly.

**Accepted consequence:** any presigned URL exposes attendee message contents, positions,
and node identities to whoever holds the link, with no auth and no revocation until it
expires. This is why §4.4 (audit) and §4.5 (short TTL) exist, and why the archive lives in
its own bucket with its own narrowly-scoped IAM.

### 6.2 Scope

Capture (A) and self-serve (B) ship as one project; the dashboard is a separate follow-on.
The `nodes.json` snapshot (C) was added to scope during design because it rides the same S3
plumbing and the same binding fix.

---

## 7. Testing

Test-first throughout. The first test earns its keep immediately:

- **Binding test** — assert `MESHTK_RECORDS_BUCKET` resolves to its field.
  *This test would have caught the existing misrouting bug.*
- **Aggregator** — N deliveries of one packet produce 1 record with N recipients; distinct
  packets never merge; window close is deterministic via an injected clock, not sleeps.
- **Partitioning** — a record stamped 15:59:59.9 lands in `hour=15` even when flushed at
  16:00.
- **Drop accounting** — a saturated buffer drops, never blocks, and the count surfaces in
  the `meta` record.
- **Upload retry** — a failing `PutObject` retains the temp file and succeeds on the next
  flush.
- **Record shape** — golden JSON per kind, so a field rename is deliberate rather than a
  silent break for every consumer.
- **Key validation (B)** — traversal, foreign prefixes, and wildcards are all rejected.
- **Gating (B)** — a non-member of `RECORDS_GROUPS` gets 403 from both list and mint.
- **Audit (B)** — the audit row is written before the URL is returned.
- **Snapshot round-trip (C)** — a restored `nodes.json` equals the snapshot; an empty local
  file triggers restore, a populated one does not.
- **Operator reset (C)** — a remote `{}` with a populated DB clears it AND skips the `PUT`;
  once clear, the next tick does not re-trigger and resumes normal snapshotting; a `GET`
  failure never resets and never blocks the `PUT`.

---

## 8. Rollout order

1. **Config binding fix** (meshtk) — prerequisite; also repairs today's misrouted logs.
2. **Records bucket + IAM + lifecycle** (terraform, monorepo).
3. **Recorder + aggregator + uploader** (meshtk), behind an off-by-default flag.
4. **Container sizing bump** (terraform `ecs-task` apply).
5. **Enable capture**, verify objects land in the right bucket with the right partitions.
6. **nodes.json snapshot/restore** (meshtk).
7. **Self-serve route + audit** (run.human).

Steps 1–5 deliver the durable archive. 6 and 7 are independent of each other and can land
in either order once 5 is verified.

Deploys go through the `deploy.yml` GitHub Actions workflow — never a local
`terragrunt apply`.

---

## 9. Known gaps

- **Container Insights is off**, so per-container memory is inferred rather than measured
  (§3.7). Enabling it would give certainty at a per-metric cost.
- **Task memory is creeping** — 28.94% → 29.56% over five hours, monotonic, roughly
  2.6 MB/hour. Extrapolated it would not reach the ceiling for ~23 days and deploys restart
  the task well before that. Unrelated to this project, but worth knowing so future growth
  is not misattributed to the recorder.
- **Shannon needs `runadmin`** granted in run.auth before self-serve is usable (§4.1).
