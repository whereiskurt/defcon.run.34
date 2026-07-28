# Routes vs Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class, shareable `Route` concept in run.gpx, separate from con-day "runs", with secure self-serve publishing, copy-to-My-Maps, run→route conversion, and admin moderation.

**Architecture:** New ElectroDB `Route` entity on `run-gpx-electro` (pk `routeId`, byOwner gsi1, byVisibility gsi2) + new `/api/gpx/routes/**` handlers following the existing GpxFile presign→confirm lifecycle and gate boilerplate. Studio UI additions live only in DC-owned files (QuickStartHub, new components, cloud-sync client, community-routes map layer modeled on my-con-runs). Runs (`GpxFile`+`conDay`) and the leaderboard reconcile machinery are untouched.

**Tech Stack:** Next.js 16 API routes, ElectroDB/DynamoDB, S3 presigned URLs, SvelteKit 5 (runes) vendored gpx-studio, vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-routes-vs-runs-design.md`

## Global Constraints

- Tests run with Node ≥22.12 (`nvm use 22.12.0`); repo default shell has 22.1.
- All API handlers use the exact gate order: session→401, `gpxstudio` service→403, `assertNotLockedLive`→403 on writes; admin surfaces return **404** to non-admins.
- Private routes return **404** (never 403) to non-owners.
- `ownerId`, `routeId`, S3 keys are always server-derived — never from request body.
- Card text: name ≤80, description ≤2000, strip U+0000–U+001F, U+007F, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069; `routeType` enum allowlist `loop|out-and-back|point-to-point`.
- Caps: 50 routes/user, 20 published/user (admins uncapped), 10 MB route GPX, copy refused if caller has ≥500 GpxFiles.
- Route entity has NO `conDay` attribute; copies to GpxFile never set `conDay`/`stravaActivityId`.
- Studio UI changes only in DC-owned files + minimal LayerControl mount; rebuild via `./build-frontend.sh`.
- Commit after every task; frequent small commits preferred.

---

### Task 1: Route card sanitizer/validator (pure lib, TDD)

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/route-card.ts`
- Test: `apps/run.gpx/webapp/src/lib/__tests__/route-card.test.ts`

**Interfaces:**
- Produces: `ROUTE_TYPES`, `RouteType`, `NAME_MAX=80`, `DESC_MAX=2000`, `sanitizeCardText(s: string): string`, `validateRouteCard(body: unknown, opts: { requireName: boolean }): { ok: true; value: { name?: string; description?: string; routeType?: RouteType } } | { ok: false; error: string }`. Used by Tasks 3–5.

- [ ] **Step 1: Write failing tests** covering: strips control chars ("a"+U+0000+U+001F+"bc" -> "abc"), strips bidi/invisible (`"xyz"` → `"xyz"`), trims, name >80 rejected, description >2000 rejected, routeType outside enum rejected, non-string name rejected, missing name rejected when `requireName`, valid full card passes, empty description allowed, sanitizer applied before length check.
- [ ] **Step 2:** `cd apps/run.gpx/webapp && nvm use 22.12.0 && npx vitest run src/lib/__tests__/route-card.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
// route-card.ts
export const ROUTE_TYPES = ["loop", "out-and-back", "point-to-point"] as const;
export type RouteType = (typeof ROUTE_TYPES)[number];
export const NAME_MAX = 80;
export const DESC_MAX = 2000;

const STRIP_RE = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeCardText(s: string): string {
  return s.replace(STRIP_RE, "").trim();
}

type Card = { name?: string; description?: string; routeType?: RouteType };
export function validateRouteCard(
  body: unknown,
  opts: { requireName: boolean }
): { ok: true; value: Card } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Card = {};
  if (b.name !== undefined) {
    if (typeof b.name !== "string") return { ok: false, error: "name must be a string" };
    const name = sanitizeCardText(b.name);
    if (!name) return { ok: false, error: "name is required" };
    if (name.length > NAME_MAX) return { ok: false, error: `name too long (max ${NAME_MAX})` };
    out.name = name;
  } else if (opts.requireName) {
    return { ok: false, error: "name is required" };
  }
  if (b.description !== undefined) {
    if (typeof b.description !== "string") return { ok: false, error: "description must be a string" };
    const description = sanitizeCardText(b.description);
    if (description.length > DESC_MAX) return { ok: false, error: `description too long (max ${DESC_MAX})` };
    out.description = description;
  }
  if (b.routeType !== undefined) {
    if (typeof b.routeType !== "string" || !(ROUTE_TYPES as readonly string[]).includes(b.routeType))
      return { ok: false, error: "invalid routeType" };
    out.routeType = b.routeType as RouteType;
  }
  return { ok: true, value: out };
}
```

- [ ] **Step 4:** Re-run tests — expect PASS.
- [ ] **Step 5:** `git add … && git commit -m "feat(gpx): route card sanitizer/validator (pure, tested)"`

---

### Task 2: Route entity + schema regression test

**Files:**
- Create: `apps/run.gpx/webapp/src/entities/route.ts` (model after `gpx-share.ts` client/table setup)
- Test: `apps/run.gpx/webapp/src/entities/__tests__/route-schema.test.ts`

**Interfaces:**
- Produces: `Route` entity, `RouteItem` type. Indexes: `byOwner` (gsi1: pk `["ownerId"]`, sk `["createdAt"]`), `byVisibility` (gsi2: pk `["visibility"]`, sk `["publishedAt"]`). **gsi3 unused** (local dev table lacks it).
- Attributes: `routeId` (req), `ownerId` (req), `name` (req), `description`, `routeType`, `bucket` (req), `key` (req), `fileSize` (number, req), `trackCount/waypointCount/totalDistance/totalElevation` (defaults 0), `bounds` (map, same shape as GpxFile), `status` `["pending","active","failed"]` default `"pending"`, `visibility` `["private","published"]` default `"private"`, `publishedAt` (number, optional — absent keeps private rows OUT of gsi2), `source` (`upload|draw|converted`), `sourceGpxFileId`, `createdByName`, `copyCount` (default 0), `createdAt`/`updatedAt` (same pattern as GpxFile).
- ElectroDB note: because gsi2's sk composite is `publishedAt`, unpublished rows (no `publishedAt`) never materialize in the byVisibility index — publishing sets both fields, unpublish removes `publishedAt` and sets `visibility:"private"`.

- [ ] **Step 1: Failing test** — import the entity schema and assert: `Route.schema.attributes.conDay === undefined` (structurally unscoreable), routeId/ownerId required, visibility enum exactly `["private","published"]`, byVisibility uses `gsi2pk-gsi2sk-index`, byOwner uses `gsi1pk-gsi1sk-index`. (Access schema via `(Route as any).model` or construct-time constants exported for test.)
- [ ] **Step 2:** Run → FAIL (module missing). **Step 3:** implement entity (copy the DynamoDBClient/table boilerplate verbatim from `gpx-share.ts:1-15`). **Step 4:** run → PASS. **Step 5:** commit `feat(gpx): Route entity (routeId pk, byOwner, byVisibility)`.

---

### Task 3: Create/list routes API (`/api/gpx/routes`)

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/route.ts`
- Create: `apps/run.gpx/webapp/src/lib/route-caps.ts` (pure: `ROUTE_TOTAL_CAP=50`, `ROUTE_PUBLISH_CAP=20`, `ROUTE_MAX_SIZE=10*1024*1024`, `COPY_FILE_SANITY_CAP=500`, `isRouteCapped(count:number, isAdmin:boolean): boolean`, `isPublishCapped(count:number, isAdmin:boolean): boolean`)
- Test: `apps/run.gpx/webapp/src/lib/__tests__/route-caps.test.ts`

**Interfaces:**
- Consumes: `validateRouteCard`, `Route` entity, `s3ClientForPresign`/`BUCKET` from `lib/s3-client`, `PRESIGN_EXPIRY_SECONDS` from `lib/constants`, `assertNotLockedLive`, `logEvent`.
- Produces: `GET /api/gpx/routes` → `{ routes: RouteItem[] }` (caller's, byOwner desc). `POST /api/gpx/routes`:
  - Upload variant `{ name, description?, routeType?, fileSize }` → `{ routeId, uploadUrl, key }`, Route `status:"pending"`, key `uploads/{ownerId}/routes/{routeId}.gpx` via new helper `getRoutePrefix(userId)` added to `lib/s3-client.ts` (`uploads/${userId}/routes/`).
  - Convert variant `{ fromFileId, name, description?, routeType? }` → server verifies `GpxFile.get({userId: session.user.id, fileId: fromFileId})` is `active`; S3 `CopyObjectCommand` (pattern: `convert-public/route.ts:66-74`); Route created `status:"active"`, `source:"converted"`, `sourceGpxFileId`, geometry summary copied from the GpxFile; **never** copies `conDay`/`stravaActivityId` (Route has no such attributes). Returns `{ route }`.
- Gates: session→401, gpxstudio→403, `assertNotLockedLive`→403. Cap: count `Route.query.byOwner({ownerId}).go({pages:"all"})` and reject ≥50 (non-admin) with 429. `fileSize` must be a positive number ≤ `ROUTE_MAX_SIZE` → else 413. Presign uses `ContentType: "application/gpx+xml"` + `ContentLength: fileSize` (same as `files/route.ts:264-270`). `createdByName` = `sanitizeCardText(session.user.name ?? "")` or undefined.

- [ ] **Step 1:** TDD `route-caps.ts` (failing test → implement → pass).
- [ ] **Step 2:** Implement the handler, mirroring `files/route.ts` structure (error handling shape included: try/catch → 500 `{error:"Failed to create route"}`, no internals leaked).
- [ ] **Step 3:** `npx tsc --noEmit` (or `npm run build` later) to type-check.
- [ ] **Step 4:** Commit `feat(gpx): routes create/list API with caps and presign`.

---

### Task 4: Route detail API (`/api/gpx/routes/[id]` + `/confirm`)

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/[id]/route.ts` (GET/PUT/DELETE)
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/[id]/confirm/route.ts`

**Interfaces:**
- `GET`: fetch `Route.get({routeId:id})`; allow if `route.ownerId === session.user.id` OR `route.visibility === "published" && route.status === "active"`; else **404**. Returns `{ route, downloadUrl }` (presigned GET, `PRESIGN_EXPIRY_SECONDS`).
- `PUT` (owner only, 404 otherwise): body → `validateRouteCard(body, {requireName:false})`; sets provided card fields. Optional `{ updateContent: true, fileSize }` → new presigned PUT to the SAME key, resets `status:"pending"` (client must re-confirm). Publishing fields are NOT writable here.
- `DELETE` (owner only, 404 otherwise): delete S3 object then `Route.delete`.
- `POST /confirm`: owner only; `status==="pending"` required (active → idempotent success, mirroring `files/[id]/confirm/route.ts:77-90`); `validateGpxFile(route.key)`; on fail delete S3 + `status:"failed"` + 400; on success parse geometry summary server-side: reuse `parseTrack`-style logic — call new helper `summarizeGpx(key)` in `lib/route-summary.ts` that GETs the full object (cap read at 10 MB), extracts `trackCount` (count `<trk`), `waypointCount` (count `<wpt`), `totalDistance` (haversine over `<trkpt` lat/lon attrs), `bounds` (min/max lat/lon) using the same regex approach as `public/aggregate/route.ts`; then `status:"active"` + summary fields set.
- Test: `apps/run.gpx/webapp/src/lib/__tests__/route-summary.test.ts` — pure function `summarizeGpxText(text: string)` (exported separately from the S3 wrapper) with a small inline 3-point GPX fixture asserting trackCount/waypointCount/bounds and distance > 0.

- [ ] **Step 1:** TDD `summarizeGpxText` (failing → implement in `lib/route-summary.ts` → pass).
- [ ] **Step 2:** Implement the three handlers with exact gate order and 404-for-private posture.
- [ ] **Step 3:** Type-check. **Step 4:** Commit `feat(gpx): route detail/confirm API (404 non-owner posture, server-side summary)`.

---

### Task 5: Publish/unpublish + community list + copy

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/[id]/publish/route.ts`
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/[id]/unpublish/route.ts`
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/community/route.ts`
- Create: `apps/run.gpx/webapp/src/app/api/gpx/routes/[id]/copy/route.ts`

**Interfaces:**
- `publish` (POST, owner only → 404): require `status==="active"`; count published via `byVisibility` filtered to `ownerId` (query `Route.query.byOwner({ownerId}).go({pages:"all"})` then count `visibility==="published"`); reject ≥20 non-admin → 429; set `visibility:"published"`, `publishedAt: Date.now()`.
- `unpublish` (POST, owner OR admin; non-owner-non-admin → 404): set `visibility:"private"`, `remove(["publishedAt"])` (ElectroDB `.remove` — drops the row from gsi2).
- `community` (GET, signed-in + gpxstudio): `Route.query.byVisibility({visibility:"published"}).go({order:"desc", limit: 100})`; filter `status==="active"`; map to manifest `{ routeId, name, description, routeType, totalDistance, bounds, createdByName, copyCount, publishedAt, downloadUrl }` with presigned GETs. No ownerId leak (attribution is `createdByName` only). `Cache-Control: private, max-age=60`.
- `copy` (POST, signed-in + gpxstudio + lockout): source route must be `published+active` OR caller-owned, else 404. Sanity cap: `GpxFile.query.byCreatedAt({userId: session.user.id}).go({pages:"all"})` count ≥500 → 429. S3 copy route object → `uploads/{userId}/gpx/{newFileId}.gpx` (`getUserPrefix`), create `GpxFile` `{ userId: session.user.id, fileId: newFileId, fileName: route.name + ".gpx", …geometry summary from route, folderId: "ROOT", source: "converted", status: "active" }` — **no `conDay`, no `stravaActivityId`**; then `Route.update({routeId}).add({copyCount: 1})`. Returns `{ fileId }`.

- [ ] **Step 1:** Implement all four handlers (publish/unpublish/community/copy) with the exact postures above.
- [ ] **Step 2:** Type-check.
- [ ] **Step 3:** Add regression test `apps/run.gpx/webapp/src/lib/__tests__/route-copy-payload.test.ts`: extract the copy's GpxFile-create payload builder into pure `buildRouteCopyPayload(route, userId, newFileId, bucket, key)` in `lib/route-copy.ts`; test asserts result has no `conDay` and no `stravaActivityId` keys and `userId` equals the caller param.
- [ ] **Step 4:** Commit `feat(gpx): publish/community/copy APIs (no-conDay copy guarantee)`.

---

### Task 6: Admin moderation API + page

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/admin/routes/route.ts` (GET list published, admin → else 404)
- Create: `apps/run.gpx/webapp/src/app/api/gpx/admin/routes/[id]/unpublish/route.ts` (POST, admin → else 404)
- Create: `apps/run.gpx/webapp/src/app/admin/routes/page.tsx` (server component: `auth()`; non-admin → `notFound()`)
- Create: `apps/run.gpx/webapp/src/app/admin/routes/RoutesTable.tsx` (client component)

**Interfaces:**
- Admin GET returns `{ routes: [{ routeId, name, createdByName, ownerId, publishedAt, copyCount, totalDistance }] }` (admin MAY see ownerId).
- Page renders `RoutesTable` (React, JSX text nodes only — no `dangerouslySetInnerHTML`): fetch list on mount, rows with Unpublish button → `POST /api/gpx/admin/routes/{id}/unpublish` → refetch. Plain minimal styling (this app has no design system on the Next side — match `app/access-denied` simplicity).

- [ ] **Step 1:** Implement both API handlers (gate: session→401 is fine, but non-admin → **404** JSON `{error:"Not found"}`).
- [ ] **Step 2:** Implement page + table. **Step 3:** Type-check. **Step 4:** Commit `feat(gpx): admin route moderation API + page`.

---

### Task 7: cloud-sync client additions (studio)

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts` (append a "Routes (2026-07-28 spec)" section at the end)

**Interfaces (produced for Tasks 8–9):**

```ts
export interface RouteSummary {
  routeId: string; name: string; description?: string; routeType?: string;
  totalDistance?: number; bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  visibility?: 'private' | 'published'; status?: string; createdByName?: string;
  copyCount?: number; publishedAt?: number; downloadUrl?: string;
}
export async function listMyRoutes(): Promise<RouteSummary[]>;            // GET  /routes
export async function createRouteFromContent(gpxContent: string, card: { name: string; description?: string; routeType?: string }): Promise<string>; // POST /routes (presign) → PUT S3 → POST /routes/{id}/confirm → routeId
export async function createRouteFromFile(fileId: string, card: { name: string; description?: string; routeType?: string }): Promise<RouteSummary>;  // POST /routes {fromFileId}
export async function updateRouteCard(routeId: string, card: { name?: string; description?: string; routeType?: string }): Promise<void>; // PUT /routes/{id}
export async function deleteRoute(routeId: string): Promise<void>;        // DELETE /routes/{id}
export async function publishRoute(routeId: string): Promise<void>;       // POST /routes/{id}/publish
export async function unpublishRoute(routeId: string): Promise<void>;     // POST /routes/{id}/unpublish
export async function listCommunityRoutes(): Promise<RouteSummary[]>;     // GET  /routes/community
export async function copyRouteToMyMaps(routeId: string): Promise<string>; // POST /routes/{id}/copy → fileId
```

All follow the existing fetch pattern (`getApiBase()`, `credentials:'include'`, 401→`redirectToLogin()`, 429→`QuotaExceededError`, 413→`FileTooLargeError`). `createRouteFromContent` mirrors `saveToCloud`'s presign→PUT→confirm sequence (`cloud-sync.ts:458-` onward) but against `/routes`.

- [ ] **Step 1:** Implement the section. **Step 2:** `cd apps/run.gpx && ./build-frontend.sh` compiles cleanly. **Step 3:** Commit `feat(gpx-studio): routes client in cloud-sync`.

---

### Task 8: QuickStartHub split + RouteCardDialog + My Routes management

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/QuickStartHub.svelte`
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/RouteCardForm.svelte`

**Behavior:**
- Hub gains a 4th card **"Create a route"** (icon `Route` from `@lucide/svelte`) directly under "Log a run", with subtitle "Build a shareable route — no date needed". New `view = 'routebuild'`.
- `routebuild` view: `RouteCardForm` (fields: name [required, maxlength 80], description [textarea, maxlength 2000], routeType [select of the 3 values + "unspecified"]), then two actions: **Upload a GPX** (hidden file input, reads file text → `createRouteFromContent`) and a hint line "or draw in the editor and use 'Save as route' from My Maps".
- Below the form, a **"My routes"** list (loaded via `listMyRoutes()` when the view opens): each row shows name, distance, `visibility` badge; actions: Publish/Unpublish toggle (`publishRoute`/`unpublishRoute`), Edit (inline reopen `RouteCardForm` prefilled → `updateRouteCard`), Delete (confirm → `deleteRoute`).
- All list rendering uses Svelte text interpolation (auto-escaped). Errors surface like the existing `error` state; 429 shows "Route limit reached".
- "Log a run" flow untouched.

- [ ] **Step 1:** Implement `RouteCardForm.svelte` (props: `initial`, `submitLabel`, `onsubmit(card)`, `busy`).
- [ ] **Step 2:** Wire the hub view + My Routes list.
- [ ] **Step 3:** `./build-frontend.sh` clean build. **Step 4:** Commit `feat(gpx-studio): Create-a-route flow + My Routes management in quick-start hub`.

---

### Task 9: Community Routes map layer + Save-as-route

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/community-routes.ts` (model exactly on `my-con-runs.ts` — whenStyleReady gating, glow+core layer pair, `communityRouteGroups` writable store)
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/CommunityRoutes.svelte` (model on `layer-control/MyConRuns.svelte`)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte` (minimal: import + instantiate next to the MyConRuns mount, add `<CommunityRoutes/>` section)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte` (one action per file row: "Save as route" → prompt via `RouteCardForm` in a small dialog → `createRouteFromFile(fileId, card)`)

**Behavior:**
- Layer fetches `listCommunityRoutes()` on first enable (default OFF), renders read-only lines (distinct color from `dc34-palette` — use `routeColor` rotation), popup on click built with **`escapeHtml`** (`components/map/escape-html.ts`) around name, description (truncated 200 chars), `createdByName`, distance; popup includes an **"Add to My Maps"** button wired like `wireRunPopupRemove` in `run-popup.ts` → `copyRouteToMyMaps(routeId)` → success toast text "Copied to My Maps".
- Failed/unauthenticated fetch leaves the store empty silently (same posture as my-con-runs).

- [ ] **Step 1:** Implement `community-routes.ts` + `CommunityRoutes.svelte`.
- [ ] **Step 2:** Wire LayerControl (keep the diff minimal — one import block, one instantiation, one component tag).
- [ ] **Step 3:** Add the CloudStorage "Save as route" row action.
- [ ] **Step 4:** `./build-frontend.sh` clean. **Step 5:** Commit `feat(gpx-studio): Community Routes layer + Save-as-route`.

---

### Task 10: Quality gates + docs

- [ ] **Step 1:** `cd apps/run.gpx/webapp && nvm use 22.12.0 && npm test` — all green.
- [ ] **Step 2:** `npm run build` (webapp) — clean. `./build-frontend.sh` — clean.
- [ ] **Step 3:** Run `/security-review` over the branch diff; fix findings.
- [ ] **Step 4:** Commit fixes; push branch; open PR titled `feat(gpx): routes vs runs — shareable Route templates` describing concept split, security posture, and no-leaderboard-impact guarantee.

### Task 11: Release + deploy (after PR merge authorization)

- [ ] `cp <main-checkout>/env.local.sh <worktree-root>/env.local.sh` (worktree landmine — FIRST).
- [ ] Merge feature PR (pre-authorized), then `./apps/release-all.sh --apps run.gpx --pr`.
- [ ] `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true`; `gh run watch`.
- [ ] Verify: `curl -s https://gpx.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'` shows the new version; authed-route 404s to curl are by design. Smoke-test `/api/gpx/routes/community` returns 401 JSON to unauthenticated probes.
