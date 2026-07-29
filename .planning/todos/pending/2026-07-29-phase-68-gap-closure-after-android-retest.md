---
created: 2026-07-29T15:45:00Z
title: "Phase 68 gap closure — waiting on Kurt's Android retest"
area: run.mqtt
resolves_phase: 68
---

Phase 68 (MQTT v5 dual codec) executed and LIVE (meshtk v0.0.72, task :115) but
verification = gaps_found (36/38). Kurt is deliberately waiting before gap closure.

**TRIGGER FIRED 2026-07-29 16:03Z — gap 2 (SC1) CLOSED with machine evidence:** real
Android v5 sessions `MeshtasticAndroidMqttProxy-!aed94d05` + second user `!84b2fcb5`,
ALLOW publishes, welcome DM delivered. VERIFICATION.md now 37/38; only gap 1 remains.
- Gap 1 (v5 parity blockers) needs code: CR-04 parse-fail = inspection
  bypass (unclamped hop reaches broker), CR-02 v5 ConnTrack only refreshed on PUBLISH
  (180s reaper → idle v5 flap), CR-03 second CONNECT/AUTH relayed with client creds.

**Next command:** `/gsd-plan-phase 68 --gaps` (reads 68-VERIFICATION.md)

Also pending merge+deploy: monorepo PR #1075 (ricky flag-line reliable delivery,
upstream meshtk#26 @ d340f36) — bundle into the gap-closure release
(buildpub apps=run.mqtt regions=use1 → deploy.yml use1) or ship earlier if wanted.
Also unshipped-but-merged hardening candidates for a later phase: CR-01 nil-Cipher
panic (no recover() in server pkg), CR-05 Data-field drop on rewrite, WR-09
kphkphkph client-ID inspection bypass, WR-17 LWT uninspected.
