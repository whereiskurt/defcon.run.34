---
created: 2026-07-29T15:45:00Z
title: "Phase 68 gap closure — waiting on Kurt's Android retest"
area: run.mqtt
resolves_phase: 68
---

Phase 68 (MQTT v5 dual codec) executed and LIVE (meshtk v0.0.72, task :115) but
verification = gaps_found (36/38). Kurt is deliberately waiting before gap closure.

**Trigger to resume:** Kurt retests Android 2.8.0-open.6 through mqtt.defcon.run:4433.
- If a real `action=MQTT5_CONNECT` appears in `/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34`
  → gap 2 (SC1 machine evidence) closes with zero code. NOTE: his node is `!174e59c8`
  (KPH_90e4; `!435990e4` is the MAC, not a node ID).
- Gap 1 (v5 parity blockers) needs code regardless: CR-04 parse-fail = inspection
  bypass (unclamped hop reaches broker), CR-02 v5 ConnTrack only refreshed on PUBLISH
  (180s reaper → idle v5 flap), CR-03 second CONNECT/AUTH relayed with client creds.

**Next command:** `/gsd-plan-phase 68 --gaps` (reads 68-VERIFICATION.md)

Also pending merge+deploy: monorepo PR #1075 (ricky flag-line reliable delivery,
upstream meshtk#26 @ d340f36) — bundle into the gap-closure release
(buildpub apps=run.mqtt regions=use1 → deploy.yml use1) or ship earlier if wanted.
Also unshipped-but-merged hardening candidates for a later phase: CR-01 nil-Cipher
panic (no recover() in server pkg), CR-05 Data-field drop on rewrite, WR-09
kphkphkph client-ID inspection bypass, WR-17 LWT uninspected.
