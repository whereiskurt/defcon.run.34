---
title: "v1.7 GPX Routes — Private Collection, Public Overlay & Strava Sync"
status: proposal (awaiting Kurt approval — not yet promoted to ROADMAP)
proposed_on: 2026-07-02
proposed_phases: [28, 29, 30, 31, 32]
app: run.gpx (gpxstudio.defcon.run / gpx.defcon.run)
requirements: [GPX-01 … GPX-15]
---

# Milestone v1.7 — GPX Routes: Private Collection, Public Overlay & Strava Sync

**One-liner:** Turn gpx.defcon.run into the home for everyone's DC34 runs —
a private per-user collection (draw / upload / **sync**), an admin-curated set of
**public toggleable map layers**, and a community "Rabbit Routes" layer gated by
admin approval.

## Data flow (the whole system)

```
  PRIVATE ROUTES (per user)             PUBLIC OVERLAY (everyone, read-only)
  ┌───────────────────────────┐         ┌───────────────────────────────────────┐
  │ draw   (exists ✅)         │ Request │  INDIVIDUAL (attributable, toggleable)│
  │ upload (exists ✅)         │ sharing │   ▸ DEF CON 34 Maps  [master ▢]       │
  │        ├──────────────────►│ (admin  │       • route A [▢]  • route B [▢]    │
  │        │                   │ curate) │   ▸ Rabbit Routes    [master ▢]       │
  │ sync from Strava (NEW)     │────────►│       • route C [▢]                   │
  │   date-banded              │         │  AGGREGATE (optional, non-attributable)│
  │   │ "Convert to public" ◄──┼─ gate   │   ▸ All Runners heatmap  [▢] (blend)  │
  └───┴───────────────────────┘          └───────────────────────────────────────┘
  admin Publish ───────────────────────► (copies a route straight into a GLOBAL folder)
```

Each **individual** GLOBAL folder renders as one read-only layer group (group master
toggle + per-route toggle); adding another community group later is free.

⚖ **Compliance = the "conversion" concept (Kurt's lawyer, 2026-07-02).** A raw Strava
import can't be re-served publicly as-is, but an explicit user action —
**"Convert to public"** — turns it into a converted artifact that *can* be shared
individually and attributably, same as a drawn/uploaded route. So: Strava sync lands
private + `source:strava` and is NOT directly shareable; the user must click "Convert to
public" (which mints a converted copy, `source:converted`, `publicShareEligible:true`)
before it can enter Request-sharing → the individual public groups. The aggregate
"All Runners" layer is now **optional** (a product nicety), not the only legal path.

## What already exists (reuse, don't rebuild)

- **Private storage + upload + draw** — gpx.studio per-user S3+DynamoDB (`GpxFile`).
- **Admin-gated GLOBAL folders** — `POST /api/gpx/folders {isGlobal:true}` requires
  `services.includes("admin")`, stored under `userId="GLOBAL"`, `MAX_GLOBAL_FOLDERS:10`;
  `GpxFile.uploadedBy` already carries attribution for global files.
- **Nested layer-group toggle UI** — `LayerTreeNode.svelte` (recursive `checked`),
  `CustomLayers.svelte`, settings stores `currentOverlays`/`selectedOverlayTree`.
  DEF CON build stripped `overlayTree.overlays` to `{}` — the UI is present, unused.
- **Strava OAuth linking + tokens** — shipped v1.2 (`next-auth/providers/strava`,
  `AUTH_STRAVA_*` in SSM `/dc34/secrets/{region}/strava/*`, `/strava` link page,
  `hasStrava` session flag, `strava_sync` quota action).

## What's new = the five phases

### Phase 28 — Public overlay rendering (view-only)  ⟵ smallest, ship first
**Goal:** Any GLOBAL folder shows in the studio as a read-only, toggleable layer group.
- `GET /api/gpx/public/maps` — unauthenticated; returns each GLOBAL folder + its
  active files (presigned GPX URLs + bounds/metadata), grouped by folder.
- Studio: fetch on load, render each folder as a layer-group node under the layer
  control — group master toggle + per-route child toggles; routes load read-only
  (not into the editable file list).
- Seed the "DEF CON 34 Maps" GLOBAL folder.
- **SC28.1** A logged-out visitor sees "DEF CON 34 Maps" as a group; toggling the
  group shows/hides all its routes; each route toggles individually.
- **SC28.2** Public routes render read-only (cannot be edited/deleted by viewers).
- **SC28.3** Endpoint returns only `status:active` files from `userId="GLOBAL"` folders.

### Phase 29 — Admin Publish
**Goal:** Anyone in the `admin` group publishes one of their routes into a GLOBAL folder.
- "Publish to…" action on an owned route (admin-gated, mirrors folder-create gating).
- Copies the S3 object + writes a new `GpxFile` row under the target GLOBAL folder,
  `uploadedBy` = original owner (attribution). **Copy, not move** — submitter keeps
  their original.
- **SC29.1** An `admin` user publishes route → appears in that group's overlay for all.
- **SC29.2** A non-admin gets 403 on the publish endpoint.
- **SC29.3** Original private route is untouched; public copy is independent.

### Phase 30 — Request-sharing + admin curation (Rabbit Routes)
**Goal:** Community members flag routes; admins curate approved ones into "Rabbit Routes".
- Add `shareRequested` boolean to `GpxFile` + a **sparse GSI** to query flagged routes
  across users (mirror the existing `byStatus` GSI pattern).
- "Request sharing" toggle in the studio on an owned route.
- Admin **curation view**: lists all `shareRequested` routes; approve = copy into the
  "Rabbit Routes" GLOBAL folder (reuses Phase 29 copy path); decline just clears/leaves.
- Seed the "Rabbit Routes" GLOBAL folder.
- **SC30.1** User toggles "Request sharing" → route appears in admin curation queue.
- **SC30.2** Admin approve → route shows in "Rabbit Routes" overlay group for all.
- **SC30.3** Un-approved / declined routes never appear in any public overlay.

### Phase 31 — Strava scheduled ingestion (date-banded)  ⟵ largest, separable
**Goal:** Poll Strava for linked users and bring their in-window runs in as private routes.
- **Scheduled polling** (Kurt's call 2026-07-02): EventBridge-scheduled worker
  (Lambda or ECS task) polls `/athlete/activities` per linked user, respecting Strava
  token refresh + rate limits (600/15min, 30k/day) with pagination + a per-user
  watermark to fetch only new activities.
- **Sync date-band (Kurt 2026-07-02):** only import activities whose start date falls
  inside a **configurable window** — his usual band is Black Hat → end of DEF CON
  (~2 weeks, ~Aug 2–11 for DC34). Store as config (SSM / admin setting), not hardcoded,
  since it shifts yearly; model as one range now, allow multiple bands later. Pass as
  Strava `after`/`before` epoch bounds so out-of-window runs are never fetched.
- Fetch each in-window activity's GPS stream → build GPX → dedupe (by Strava activity
  id) → write as a `status:active` **private** `GpxFile` for that user, tagged
  `source:strava`, `publicShareEligible:false` until converted (see conversion gate).
- **"Convert to public" gate (compliance, GPX-11):** a `source:strava` route is not
  directly shareable. An explicit user "Convert to public" action mints a converted
  copy (`source:converted`, `publicShareEligible:true`) that then flows through the
  normal Request-sharing → curation path (Phase 30). The raw import stays untouched.
- **SC31.1** A linked user's new *in-window* Strava runs appear in their private routes automatically.
- **SC31.2** Activities outside the configured date band are never imported.
- **SC31.3** Re-runs don't duplicate already-imported activities.
- **SC31.4** Token refresh + rate-limit backoff handled; a throttled/failed user is
  retried next cycle, not dropped.
- **SC31.5** A `source:strava` route cannot enter Request-sharing until the user runs
  "Convert to public"; the converted copy is what becomes publicly shareable.

### Phase 32 — (OPTIONAL) Aggregate "All Runners" overlay
**Goal:** A single non-attributable blended layer of everyone's runs — a product nicety
now that conversion (Phase 31) already gives a compliant individual path. Include only
if Kurt wants the heatmap; not required for compliance.
- Opt-in: users choose "add my runs to the public heatmap" (default off). Eligible
  sources: Strava-synced + any private route the user opts in.
- Build a blended density/heatmap (or merged unlabeled geometry) from all opted-in
  runs — **no names, no per-route toggles, no attribution.** Rendered as one toggle
  in the overlay ("All Runners").
- Regenerated on a schedule (reuse the Phase 31 worker cadence).
- **SC32.1** The aggregate layer shows blended run density with a single on/off toggle.
- **SC32.2** No individual route, name, or user is identifiable or separately toggleable.
- **SC32.3** Only opted-in users' runs are included; opting out removes them next rebuild.

## Cross-cutting

**Data-model deltas**
- `GpxFile`: add `shareRequested:boolean` (Phase 30) + sparse GSI; add `stravaActivityId`
  for dedupe (Phase 31). Reuse `uploadedBy` for attribution.
- Two seeded GLOBAL folders: "DEF CON 34 Maps", "Rabbit Routes".
- (Later) `tags:["race"]` sub-grouping for race maps — no schema change needed.

**Risks / blockers**
- ✅ **Strava API terms — RESOLVED via the "conversion" concept (Kurt's lawyer, 2026-07-02).**
  A raw Strava import may not be re-served publicly, but an explicit **"Convert to public"**
  user action produces a converted artifact that may be shared individually and attributably.
  Design invariant to enforce in code review: `source:strava` routes start
  `publicShareEligible:false` and are blocked from Request-sharing/Publish until the user
  converts them (minting a `source:converted`, `publicShareEligible:true` copy). Log/record
  the conversion action for provenance.
- Public unauthenticated endpoint (Phase 28) — cache + rate-limit; presigned URLs
  short-TTL; only GLOBAL/active files exposed.
- Phase 31 needs new infra (EventBridge + worker + secret access) → Terraform/terragrunt
  in `infra/` and a build/deploy path; largest surface area.

**Sequencing / dependencies**
- 28 → 29 → 30 are a clean chain (29's copy path is reused by 30).
- 31 (ingestion, private-only) is independent of 28–30 and can run in parallel.
- 32 (aggregate overlay) is OPTIONAL; if built, depends on 31 and reuses 28's rendering.
- Suggested order: 28, 29, 30, 31, then 32 only if Kurt wants the heatmap.

## Requirements (GPX-01 … GPX-12)
- GPX-01 Public read-only overlay of GLOBAL folders with group + per-route toggles
- GPX-02 Unauthenticated public maps endpoint (GLOBAL/active only)
- GPX-03 Seed "DEF CON 34 Maps" GLOBAL folder
- GPX-04 Admin Publish action (copy owned route → GLOBAL folder, admin-gated)
- GPX-05 Attribution preserved via `uploadedBy`; original untouched
- GPX-06 `shareRequested` flag + "Request sharing" UI
- GPX-07 Admin curation view of flagged routes
- GPX-08 Approve → copy into "Rabbit Routes"; decline is a no-op
- GPX-09 Strava scheduled poll of linked users with token refresh + rate-limit handling
- GPX-10 Activity → GPX conversion + dedupe into private routes
- GPX-11 Compliance: `source:strava` routes blocked from public sharing until an explicit
  "Convert to public" action mints a `source:converted`, `publicShareEligible:true` copy
- GPX-12 Ingestion infra (EventBridge worker) in Terraform
- GPX-13 Configurable sync date-band (default Black Hat→end of DEF CON ~2wk); out-of-window runs never fetched
- GPX-14 "Convert to public" action + provenance record for converted Strava routes
- GPX-15 (optional) Aggregate "All Runners" overlay — blended, non-attributable, opt-in, single toggle

## To promote
On approval: `/gsd-review-backlog` (or `/gsd-new-milestone` v1.7) to pull phases 28–31
into ROADMAP.md, then plan/execute per the yolo PR-per-phase flow. Phase 31's Strava
compliance item (GPX-11) is flagged as a blocker-class success criterion.
