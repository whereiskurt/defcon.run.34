# Dynamic Scheduled QR Codes — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Branch:** `gsd/dynamic-scheduled-qr`

## Summary

A **dynamic scheduled QR code** is a single, fixed QR image whose *destination* changes
over time on a schedule the operator defines. The image printed on a bib or on signage
never changes; where it sends a scanner is data. At any given moment every scanner of the
same code lands in the same place.

This is a **shared campaign code** model (not per-user). Examples: a `RICKROLL` code that
points at a welcome page while bibs are handed out, flips to a rickroll after the morning
run, and flips to the Rebar afterparty at night — all without reprinting anything.

The good news: the resolver machinery to do this **already exists**. This project is
primarily a better *authoring experience* on top of it, plus routing the short vanity
domains (`r.` / `h.`) through that same resolver so they too become schedulable.

## Background — what already exists

- **Resolver** (`apps/run.qr/lambda/resolver/`): CloudFront → ALB → Lambda → DynamoDB.
  Given `q.defcon.run/<CODE>` it looks up a `Qr` row and resolves a destination.
- **Time rules** (`lib/rules.mjs`): each `Qr` row has a `rules` list; the resolver picks
  the **first rule whose half-open window `[from, to)` contains "now"**, else falls back to
  param rules, else to the base `destination`. Time rules already beat everything else.
  **This is exactly a scheduled redirect** — it is just authored today as raw UTC datetime
  windows.
- **Admin CRUD UI** (`apps/run.human/webapp/src/app/(protected)/admin/qr/`): server
  components gated by `admin-gate`, data via `qr-admin.ts` (ElectroDB on the shared
  `run-human-electro` table), mutations POSTed to `/api/admin/qr`. A `QrForm.tsx` rules
  editor already converts local wall-clock ↔ stored UTC.
- **Vanity short domains** (`r.` → rickroll, `h.` → run.defcon.run): today these are
  **static edge redirects** — a CloudFront Function returns one fixed `location`. They are
  driven by `apps/run.human/webapp/src/data/redirects.json` +
  `infra/terraform/modules/cloudfront-redirect/`. A CloudFront Function cannot do time
  logic or DB lookups, so today they cannot be dynamic.

## Decisions (from brainstorming)

1. **Shared campaign codes**, not per-user bib codes.
2. **Timeline of switch-points** authoring model (not from–to windows, not manual-only).
3. **Approach A**: build a con-aware authoring UI that *compiles* to the existing resolver
   `rules`; the resolver Lambda is **not** changed.
4. **`r.` / `h.` become dynamic in v1** by routing them through the resolver.
5. **Any date is allowed** — switch-points are not limited to the four con days. Con days
   are convenience presets and default group labels only.

## Design

### 1. Data model — reuse `Qr`, add one attribute

No new entity or table. Add an additive `schedule` attribute to the `Qr` ElectroDB entity:

```
schedule: [
  { startsAt: <UTC ISO 8601>, destination: <url>, label?: <string> },
  ...
]
```

- `schedule` is the **authoring source of truth**.
- The existing base `destination` field remains the **pre-schedule / fallback** default
  (used before the first switch-point, or when `schedule` is empty).
- Rows without `schedule` are unaffected — fully backward compatible.

### 2. Compiler: switch-points → `rules` (pure function, no resolver change)

On every save, a pure function compiles `schedule` into the resolver's `rules`:

1. Sort switch-points ascending by `startsAt`.
2. Emit a window per switch-point: window *i* = `{ from: startsAt[i], to: startsAt[i+1],
   destination: destination[i] }`.
3. The **last** switch-point is open-ended: emit `to` as a far-future sentinel ISO
   (e.g. `2999-01-01T00:00:00Z`) so it matches indefinitely.
4. Write the result to `rules`. The resolver reads `rules` exactly as it does today.

Because the resolver falls back to base `destination` when no window matches, the period
**before** the first switch-point automatically serves the base destination.

Guarantees the compiler must hold (covered by tests):
- Output windows are non-overlapping and gap-free between the first and last switch-point.
- Empty `schedule` → empty `rules` (pure base-destination behavior).
- Single switch-point → one open-ended window.
- Stored/compiled times are always UTC.

### 3. Timezone — fixed to `America/Los_Angeles`

All switch-points are **authored and displayed in Vegas time** regardless of the operator's
browser timezone; values are stored as UTC ISO. This removes the "authored from the wrong
timezone" failure mode. Con-day labels/grouping are derived in PT.

Con days are a small config constant used only for quick-add shortcuts and default group
labels — **assumed Thu Aug 6 – Sun Aug 9, 2026 (confirm actual DEF CON 34 dates).**
Switch-points themselves may be on **any date**, past config or not.

### 4. Admin UI (clone the existing `admin/qr` pattern)

Location: extend `apps/run.human/webapp/src/app/(protected)/admin/qr/`. Reuse `admin-gate`
(denials → `notFound()`), `qr-admin.ts`, and the `/api/admin/qr` route.

- **List view** (`admin/qr`): add a **"LIVE now →"** column showing each scheduled code's
  currently-resolved destination (compute the active window server-side at request time).
- **Per-code page**: a **chronological switch-point editor**:
  - Switch-points grouped under date headers (any date), in time order.
  - The currently-active switch-point is marked `◀ LIVE`.
  - Each row: PT time, destination, `[edit]`; plus `[ + add switch-point ]`.
  - Quick-add shortcuts for the con days (jump the date/time picker to Thu/Fri/Sat/Sun).
  - Full date+time picker allows any date.
- **⚡ Publish now**: inserts a switch-point at the current PT moment with a chosen
  destination, compiles, saves. Note: propagation is bounded by the resolver's **60s warm
  cache** — a flip goes live within ~60s.
- When a `schedule` exists, it **owns** `rules`; the legacy raw-rules editor is shown
  read-only (or hidden) for that code to avoid two editors fighting over `rules`.

### 5. Short domains `r.` / `h.` become dynamic (v1) — redirect-target approach

**Chosen approach (2026-07-18): point the existing vanity redirects AT the resolver, don't
move the domains onto it.** This is far lower-risk than re-homing the CloudFront distros.

The `r.`/`h.` vanity domains already work via the `cloudfront-redirect` module: a per-host
CloudFront distribution serves a private-S3 **interstitial** (`<host>/index.html`) that
renders OG unfurl tags for crawlers and does a client redirect to a `target_url` built from
the record's `target_host`/`target_path`/`target_query` in `redirects.json`.

So we simply change where they point:

- `redirects.json` `r` → `target_host: q.defcon.run`, `target_path: /R` (302).
- `redirects.json` `h` → `target_host: q.defcon.run`, `target_path: /H` (302).
- Seed `Qr` rows `R` (base `destination` = current rickroll `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
  and `H` (base = `https://run.defcon.run/`) so today's behavior is preserved before any
  schedule is added. Seed **before** applying so `q.defcon.run/R|H` never 404s.
- Apply the `redirect-rules` Terragrunt unit — this only re-renders the two S3 interstitial
  objects (and the unassociated legacy edge functions). **No** CloudFront distribution,
  Route53, ACM, or ALB change; **no** downtime; fully reversible (revert `redirects.json`).

Net effect: `r.defcon.run` still shows its "Run Hacker Run!" unfurl card, then routes
through `q.defcon.run/R` where the schedule decides the destination. Cost: one extra ~302
hop (the interstitial was already in the path — only its target changed). The resolver is
**not** changed. The heavier "add `r.`/`h.` as aliases on the resolver distro" option was
rejected: it needs a module rewrite (multi-host aliases + ALB host rule + a Host→path
CloudFront Function), a destroy/recreate of live distros (CloudFront `CNAMEAlreadyExists`
sequencing), a cross-state Route53 move with a downtime window, and it loses the unfurl
cards.

### 6. Testing

- **Unit (TDD)** on the compiler: sort order, consecutive/gap-free windows, open-ended last
  window, empty-schedule, single-entry, PT→UTC correctness.
- **Unit** on con-day bucketing / PT grouping and the "LIVE now" active-window selector.
- **Resolver**: reuse `rules.mjs` tests to assert compiled `rules` resolve to the expected
  destination at representative timestamps (before first, mid-schedule, after last).
- **Infra/E2E**: headless `curl` checks that `r.`/`h.` route through the resolver and honor
  the active switch-point; manual/Playwright pass on the editor, LIVE marker, and Publish-now.

## Out of scope (YAGNI)

- Recurring weekly/daily rules (fixed dates are sufficient).
- Per-user scheduling (this is shared campaign codes).
- A timezone picker (PT is fixed).
- Any new microservice or DynamoDB table.

## Open items to confirm

- **Actual DEF CON 34 dates** for the con-day quick-add presets (assumed Thu Aug 6 –
  Sun Aug 9, 2026).
- Current production destination targets for the seeded `R` and `H` base destinations
  (to preserve today's behavior exactly).
