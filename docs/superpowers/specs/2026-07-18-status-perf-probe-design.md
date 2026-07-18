# status.defcon.run — per-service perf probe

**Date:** 2026-07-18
**Status:** approved, shipping (low-risk static-page update)

## Goal

Let anyone on status.defcon.run push a button on a service and see, in plain terms,
**how fast** it responds and **how big** it is to load — so they know how it'll feel
over con-floor mobile / hotel wifi.

## The two numbers, each from its best source

There are two different "how fast is it" questions, and they want different sources:

| Number | Meaning | Source |
|--------|---------|--------|
| **Speed (ms)** | How does it feel from *my* device right now | LIVE client probe, from the visitor's own connection |
| **Size (KB/MB)** | How heavy is the full page to pull | BAKED build/deploy truth, measured server-side by Playwright |

### Why size is baked, not probed live
Next.js bundle URLs are hash-stamped and change every release, and cross-origin
`PerformanceResourceTiming` zeroes `transferSize` without a `Timing-Allow-Origin`
header on every service. Both problems vanish if we measure size **server-side**
at build/refresh time, where CORS doesn't apply and hashes don't matter.

### Why the MVP needs zero infra
A cross-origin `PerformanceResourceTiming` still exposes `duration` (full fetch
round-trip) **without** any header — only the detailed TTFB/TLS breakdown and
transfer-bytes are zeroed. Since size comes from Playwright, the browser probe
needs nothing but `duration`. So the MVP touches **no terraform**. Adding
`Timing-Allow-Origin: *` per service is an optional phase-2 nicety for a TTFB
breakdown only.

## Components

### 1. `apps/run.status/measure-size.mjs` (new)
Playwright script, run before release. Reads `site/status.json`, loads each
service's `link || https://host` in headless chromium, sums every response's
transferred (compressed) bytes → true full-page weight, and writes back per
service: `size_kb`, `req_count`, `measured_at`. Framework-agnostic (Next.js /
Strapi / Svelte all measured identically). Backed by `apps/run.status/package.json`
(dev-only; the page itself still ships with no build step).

### 2. `apps/run.status/site/index.html` (edit)
- A **⚡ test** control per service card (rendered in `render()`).
- On click: 3× `fetch(url, { mode:'no-cors', cache:'no-store' })`, clearing
  resource timings between samples, take the **median `duration`**.
- Render inline: e.g. `142 ms · 1.8 MB` — ms is live, MB is the baked `size_kb`.
  Colour-coded snappy / ok / heavy by latency threshold.
- Results cached in-memory per service id so the 300s status.json poll re-render
  doesn't wipe a result the visitor just saw.
- Click handling via delegation on the grid container (survives re-renders) and
  `preventDefault`/`stopPropagation` so probing a linked card doesn't navigate.

### 3. `apps/run.status/site/status.json` (additive fields)
`size_kb`, `req_count`, `measured_at` per service. No change to the existing
`state` vocabulary or the `dc34-statuspage` skill flow (which only edits `state`).

## Deploy
`node measure-size.mjs` → writes `status.json` → existing `./release.sh` publishes
(full sync, since a non-json-only file changed). No new infra, no other apps touched.

## Caveats
- `mode:'no-cors'` responses are opaque: we get timing, not status codes. A truly
  unreachable host rejects the fetch → shown as "unreachable".
- Latency = endpoint responsiveness (root document round-trip); size = full-app
  weight. Together: "responds snappily, but it's a heavy pull."
- Refreshing sizes needs Playwright/chromium installed (already in the repo for
  auth e2e). The shipped page needs none of it.
