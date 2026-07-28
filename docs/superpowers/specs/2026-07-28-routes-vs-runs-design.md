# Routes vs Runs — Design Spec

**Date:** 2026-07-28
**Service:** run.gpx (gpx.defcon.run)
**Status:** Approved by Kurt (2026-07-28) — model, sharing, copy semantics, and scope chosen via Q&A; security-hardening emphasis added.

## 1. Problem

Today a single `GpxFile` entity plays two roles. The only thing that makes a file a
"run" is an optional `conDay` tag (`status==="active" && conDay && userId!=="GLOBAL"`
is the leaderboard's entire definition of a scored run, enforced by the reconcile
protocol in `lib/gpx-reconcile.ts:103-105`). "Routes" exist only
informally: untagged GpxFiles, the admin-only `GLOBAL` partition, and the CMS `Route`
collection. Users cannot create, edit, and share a route template with the whole
community, and the upload UX forces a date onto everything.

## 2. Concepts

| | **Run** | **Route** |
|---|---|---|
| What | An instance — something that happened at a point in time | A template — editable, evolving, dateless |
| Storage | `GpxFile` + `conDay` (unchanged) | New `Route` entity |
| Visibility | Private to the runner | Private by default; owner may publish to all signed-in users |
| Scoring | Counts (Accomplishment/leaderboard, unchanged) | Never scores — the entity has no `conDay` attribute at all |
| Conversion | — | A run can be *copied* into a route (fresh S3 object, provenance kept) |

A published route may be **copied** by any signed-in user into their My Maps as a
private, dateless `GpxFile` snapshot ("Add to My Maps"). Owner edits after the copy
do not propagate (explicit product decision — copy, not subscription).

## 3. Data model

New ElectroDB entity **`Route`** on the existing `run-gpx-electro` table
(service `"gpx"`, no infra change). Pattern follows `MeshRadio` (global id pk +
owner GSI).

- **Keys:** pk `["routeId"]`, sk `[]`.
  - `byOwner` — gsi1: pk `["ownerId"]`, sk `["createdAt"]`
  - `byVisibility` — gsi2: pk `["visibility"]`, sk `["publishedAt"]`
  - **gsi3 is not used** (local dev `run-gpx-electro` only has gsi1/gsi2).
- **Attributes:**
  - `routeId` — server-generated uuid (never client-supplied)
  - `ownerId` — OIDC sub from session (never client-supplied)
  - `name` (required), `description`, `routeType` (`loop|out-and-back|point-to-point`)
  - `bucket`, `key` — S3 pointer, key = `uploads/ROUTES/{routeId}.gpx` (sentinel
    prefix, NO user identifier — presigned URLs expose the key path to other
    signed-in users; security-review finding 2026-07-28)
  - `status` — `pending|active|failed` (same presign→confirm lifecycle as GpxFile)
  - `visibility` — `private|published` (default `private`); `publishedAt`
  - Derived geometry summary: `distance`, `elevation`, `bounds`, `trackCount`, `waypointCount`
  - Provenance: `source` (`upload|draw|converted`), `sourceGpxFileId`
  - `copyCount` (int, server-incremented), `createdAt`, `updatedAt`
- **No `conDay` attribute exists** → a Route is structurally unscoreable; the
  reconcile protocol, `Accomplishment`, and `RunUser` rollups are untouched.

### S3 layout
`uploads/ROUTES/{routeId}.gpx` — fully server-derived, keyed by the unguessable
server-minted routeId only. Deliberately contains no user identifier: presigned
GET URLs carry the object key in their path and are handed to non-owners, so an
owner-scoped key would leak the OIDC sub. Route content updates overwrite in
place (no version chain in v1; YAGNI).

## 4. API surface (all under `apps/run.gpx/webapp/src/app/api/gpx/`)

Uniform gate order on every handler (matches existing boilerplate):
`session?.user?.id` → 401 · `services.includes("gpxstudio")` → 403 ·
`assertNotLockedLive(session.user.id)` on **every** write · admin ops additionally
`services.includes("admin")` → 404 (non-disclosure).

| Route | Method | Behavior |
|---|---|---|
| `routes` | GET | List caller's routes (`byOwner`) |
| `routes` | POST | Create: validate card fields, enforce per-user route cap, mint presigned PUT (content-length-range capped), write `Route` `status:"pending"`. `{fromFileId}` variant: server-side S3 copy from caller's own GpxFile (ownership checked), skips presign |
| `routes/[id]` | GET | Owner or published-only; non-owner+private → **404** (no 403 oracle) |
| `routes/[id]` | PUT | Owner only; card metadata edit (re-validated/sanitized) and/or `updateContent` re-presign→confirm |
| `routes/[id]` | DELETE | Owner only; delete DDB row + S3 object |
| `routes/[id]/confirm` | POST | Validate uploaded bytes with the existing hardened GPX parse (size cap, structure check); compute geometry summary server-side; `pending→active`; on failure delete S3 object + mark `failed` |
| `routes/[id]/publish` | POST | Owner only; `active` only; enforce published-routes cap (20/user, admins uncapped); set `visibility:"published"`, `publishedAt` |
| `routes/[id]/unpublish` | POST | Owner or admin |
| `routes/community` | GET | Signed-in only. `byVisibility` query (`published`), presigned GET URLs (1h), card metadata + attribution. Capped page size |
| `routes/[id]/copy` | POST | Signed-in; source must be `published` (or caller-owned); S3 copy → new `GpxFile` in caller's ROOT folder, **no `conDay`**, `source:"converted"`; increment `copyCount` |
| `admin/routes` | GET | Admin: list published routes |
| `admin/routes/[id]/unpublish` | POST | Admin unpublish |

Run→route conversion (`POST /routes {fromFileId}`) mirrors the existing
`convert-public`/`publish` copy pattern: fresh id, fresh S3 object, and **no
carrying of `conDay`/`stravaActivityId`** — the same omission that prevents
double-scoring today.

## 5. Threat model & input sanitization (attacker mindset)

Assume every request field, every stored string, and every GPX byte is hostile.

**Identity & authorization**
- `ownerId` is always `session.user.id` (OIDC sub). No handler ever reads a user id,
  owner id, or S3 key/prefix from the request body.
- IDOR: all `routes/[id]` access re-fetches the row and checks
  `row.ownerId === session.user.id` (or `visibility === "published"` for read/copy).
  Private rows return 404 to non-owners — never 403 — matching the `GpxShare`
  anti-enumeration posture. `routeId` is an unguessable uuid.
- Admin endpoints return 404 (not 403) to non-admins — non-disclosure gate.
- `assertNotLockedLive` on every mutating handler (write-boundary lockout ≤15s).

**Card text (name / description / routeType)**
- Server-side on create *and* update: trim; strip control chars (U+0000–U+001F,
  U+007F) and bidi/invisible overrides (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069);
  length caps (name ≤ 80, description ≤ 2000); `routeType` strict enum allowlist;
  reject rather than silently truncate where feasible. Stored as plain text only —
  no markdown, no HTML.
- Render-side: Svelte text interpolation (auto-escaped) in components; any MapLibre
  popup built with string HTML goes through the existing `escape-html.ts` helper
  (same rule that already protects rabbit/ghost popups). The React admin page uses
  JSX text nodes only — no `dangerouslySetInnerHTML`.
- URLs in descriptions render as inert text (no anchor generation).

**GPX content**
- Presigned PUT constrained with `content-length-range` (10 MB cap) and fixed
  content type; the S3 key is fully server-generated (`uploads/ROUTES/{routeId}.gpx`) so a
  client can never influence where an object lands.
- `confirm` re-downloads and validates bytes with the existing hardened parser
  (Phase 64 posture): size re-check, structural GPX check, no DTD/external-entity
  resolution, geometry summary computed server-side (never trusted from client).
- Community/copy endpoints serve files only via short-lived presigned GETs; GPX from
  other users is loaded into the map exactly like existing shared/official files
  (already-sanitized display path, `rel=noopener`, no `<img>` in waypoint popups).

**Abuse & resource limits**
- Per-user caps: total routes (50), published routes (20); community list page cap.
  The copy endpoint does not consume the lifetime `gpx_upload` quota, but enforces a
  per-caller total-file sanity cap (refuse above 500 GpxFiles, cheap single-partition
  count) so it cannot be used for unbounded row/object creation. Admin bypass only
  via `services.includes("admin")`.
- `copyCount` incremented server-side only; no client-writable counters.
- All error responses are generic; no stack traces, no existence oracles.

**Cross-service**
- No new internal HTTP surfaces. Routes never call run.human — nothing for the
  reconcile/accomplishment machinery to see.

## 6. UI (gpx-studio — files we fully own; no vendored-file surgery)

- **QuickStartHub** — becomes the untangling point: two primary paths,
  **"Log a run"** (existing day-picker flow, unchanged mechanics) and
  **"Create a route"** (upload a GPX or start drawing; no date; opens the route
  card editor on save).
- **Route card dialog** — name, description, route type; used at create and edit.
- **My Routes** — section alongside My Maps (in `CloudStorage.svelte` orbit):
  list own routes, edit card, publish/unpublish toggle, delete, "Save as route"
  results land here.
- **Community Routes layer** — new section in `LayerControl.svelte` next to the
  official DEF CON maps: lists published routes (fetched authed), toggle per route,
  card popup (escaped) with attribution + **"Add to My Maps"** (copy endpoint).
- **"Save as route"** — action on an existing file/run row (My Maps / My DEF CON
  Runs) invoking the `{fromFileId}` create path.
- All new UI lives in our layer-(a) files (`QuickStartHub.svelte`, new
  `cloud/RouteCardDialog.svelte`, new `map/community-routes.ts` +
  `layer-control/CommunityRoutes.svelte`, `cloud-sync.ts` client additions).
  `LayerControl.svelte` gets a minimal mount hook (it is already DC-modified).

## 7. Admin moderation

Next.js page `webapp/src/app/admin/routes/page.tsx` (+ server actions or fetch to
the admin API): table of published community routes (name, owner, published date,
copy count), one-click unpublish. Session + admin-service gated; unauthenticated
gets 404 by design.

## 8. Error handling

- Presign/confirm failures follow the GpxFile precedent: S3 object deleted, row
  marked `failed`; client shows a retryable error.
- Community layer fetch failures degrade silently to "layer unavailable" (same
  best-effort posture as CMS overlays).
- Copy endpoint is idempotent-safe: each copy mints a fresh fileId; no partial-state
  row is left `active` without a validated S3 object.

## 9. Testing

- **Pure-core TDD (vitest, Node ≥22.12):** card sanitizer/validator (control chars,
  bidi, length, enum), publish-cap logic, copy-payload builder (asserts no `conDay`
  ever appears), community-listing shaper.
- **Entity/API:** handler-level tests for the authz matrix (owner/non-owner/admin ×
  private/published × read/write) where the existing test harness allows.
- **Regression guard:** a test asserting the Route entity schema contains no
  `conDay` attribute and that copy output omits `conDay`/`stravaActivityId`.
- Manual smoke post-deploy: create → publish → copy from second account path, plus
  leaderboard reconcile untouched (existing runs unchanged).

## 10. Out of scope

Heatmap (later milestone) · route subscriptions/live-pinning (copy chosen instead) ·
CMS authoring changes · Strava-sourced route creation beyond existing convert flow ·
GpxFile version-chain for routes.
