---
created: 2026-07-30T16:20:00Z
title: "meshtk WR-02: logSafe strips C0+DEL but not C1 control block"
area: run.mqtt
priority: low
source: 69-REVIEW.md / 69-VERIFICATION.md
---

Non-blocking warning carried forward from Phase 69 code review + verification. Confirmed
still open in the vendored source (`apps/run.mqtt/meshtk/internal/app/server/logsafe.go:56`)
and equally in upstream `~/working/meshtk`.

## What

`logSafe` sanitizes C0 control characters (0x00–0x1F) plus DEL (0x7F) but leaves the **C1**
control block (U+0080–U+009F) untouched — e.g. U+009B (CSI) reaches the raw log.

## Why it's low priority

The grep-line forgery vector Phase 69 closed is genuinely closed (grep splits on 0x0A, which
`logSafe` strips). The residual is **terminal-scramble only** — a hostile client id/username
with C1 bytes can garble a human reading the raw log in a terminal, which is the exact outcome
the function's own doc comment claims to prevent. Extend the strip to cover U+0080–U+009F.

## Fix location

Upstream first (`~/working/meshtk`), then vendor-sync to `apps/run.mqtt/meshtk`. See
[[2026-07-29-meshtk-proxy-shared-chain-blockers]].
