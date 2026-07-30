---
created: 2026-07-30T16:20:00Z
title: "meshtk WR-01: v5 PUBLISH forwards uninspected on type-assert failure (fail-open)"
area: run.mqtt
priority: low
source: 69-REVIEW.md / 69-VERIFICATION.md
---

Non-blocking warning carried forward from Phase 69 code review + verification. Confirmed
still open in the vendored source (`apps/run.mqtt/meshtk/internal/app/server/proxy_v5.go:396-399`)
and equally in upstream `~/working/meshtk`.

## What

When `v5.ReadPacket` succeeds but the decoded content is **not** a `*v5.Publish`,
`handleV5PublishUplink` forwards the frame **uninspected** — the same CR-04 bypass class
Phase 69 exists to close. Its CONNECT-path sibling `connectFromV5Packet` already fails
**closed** on the identical unreachable case.

## Why it's low priority

Unreachable through the socket today (the frame type is already established as PUBLISH before
this arm runs), so it's defence-in-depth only — but it's the odd-one-out on a file whose whole
design stance is fail-closed. Make this arm fail closed (Block / drop) to match its sibling.

## Fix location

Upstream first (`~/working/meshtk`), then vendor-sync to `apps/run.mqtt/meshtk` — same flow as
Phase 69. See [[2026-07-29-meshtk-proxy-shared-chain-blockers]].
