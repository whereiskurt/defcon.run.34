# Phase 71: Heat Map Layers — DC33 + DC34 Flame Stacks - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 7 (5 new, 2 modified)
**Analogs found:** 6 / 7 (1 partial — no S3-artifact *writer* exists in this repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/run.gpx/webapp/src/app/api/gpx/public/heatmap/[year]/route.ts` (NEW) | route (public API) | request-response / read-through cache | `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` | exact |
| `apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts` (NEW, recommended) | route (internal worker) | batch / transform | `apps/run.gpx/webapp/src/app/api/gpx/internal/strava-sync/route.ts` | exact |
| `apps/run.gpx/webapp/src/lib/heatmap-build.ts` (NEW) | service | batch DDB-scan → S3 read → S3 write | `apps/run.gpx/webapp/src/lib/gpx-reconcile.ts` + `aggregate/route.ts` | role-match |
| `infra/terraform/modules/heatmap-scheduler/v1.0.0/**` + `infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl` (NEW) | config (Lambda + EventBridge) | event-driven (cron) | `infra/terraform/modules/strava-sync-scheduler/v1.1.0/**` + `live/site/region/us-east-1/strava-sync-scheduler/terragrunt.hcl` | exact |
| `apps/run.gpx/webapp/scripts/backfill-dc33-heatmap.ts` (NEW) | script (one-off backfill) | file-I/O / batch | `apps/run.gpx/webapp/scripts/import-dc33.ts` | exact |
| `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` (NEW) | layer class | fetch-once + lazy toggle | `public-overlays.ts` `addAggregate()` + `deuce-layer.ts` class shape | exact (split across two) |
| `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/HeatMap.svelte` (NEW) + `LayerControl.svelte` (MODIFY) | component | UI state | `layer-control/PublicOverlays.svelte` | exact |
| `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` lines 6–17 (MODIFY, HEAT-06) | comment | n/a | — | n/a |

---

## Pattern Assignments

### 1. `api/gpx/public/heatmap/[year]/route.ts` (route, request-response)

**Analog:** `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` (91 lines, read in full)

**Imports + module doc + cache constant** (lines 1–20):
```typescript
import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client } from "@/lib/s3-client";

/**
 * GET /api/gpx/public/aggregate - Public, UNAUTHENTICATED "All Runners" aggregate (Phase 32).
 * ...
 */
const CACHE_SECONDS = 600;
```
No auth, no session import — the "unauthenticated public route" pattern here is simply the
**absence** of any `auth()` call plus the `public/` path segment. Nothing else gates it.

**Bare-geometry, non-attributable feature shape** (lines 61–66) — copy verbatim for the artifact:
```typescript
// Bare geometry — deliberately NO properties (non-attributable).
return {
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates },
};
```

**Response + CDN cache headers** (lines 73–83) — the exact Cache-Control shape to reuse
(pick a longer `CACHE_SECONDS` for a precomputed artifact):
```typescript
return NextResponse.json(
  { type: "FeatureCollection", features: features.filter(Boolean) },
  {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
    },
  }
);
```

**Error handling** (lines 84–90) — log + generic 500, never leak internals:
```typescript
} catch (error) {
  console.error("Error building aggregate:", error);
  return NextResponse.json({ error: "Failed to build aggregate" }, { status: 500 });
}
```

**GPX → coordinates helper** (lines 22–33) — `trkptCoords`, the `[lon, lat]` GeoJSON-order
regex parser. Note this is a *third* copy of the same regex (see also
`gpx-accomplishment.ts:70-71` and `import-dc33.ts:64`); the builder should use one of them,
not invent a fourth.

**Deltas the planner must specify:**
- `[year]` dynamic segment → validate against an allowlist (`dc33` | `dc34`), 404 otherwise.
- Reads a precomputed S3 artifact (`GetObjectCommand` on a known key) instead of scanning
  DynamoDB — the aggregate route's own line 15–16 comment recommends exactly this migration.
- Response must carry `meta {generatedAt, runCount, totalKm}` alongside `features`.

---

### 2. Internal builder route (route, batch) — *recommended over a fat Lambda*

**Analog:** `apps/run.gpx/webapp/src/app/api/gpx/internal/strava-sync/route.ts` (54 lines, read in full)

**Shared-secret guard** (lines 21–26) — copy verbatim, including the fallback:
```typescript
// the Lambda invoker sends the shared secret as `INTERNAL_SYNC_SECRET`, but the deployed
// tasks only carry `AUTH_INTERNAL_SECRET` — fall back to it so the guard doesn't
// reject a legitimately-secreted request.
const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
if (!secret || request.headers.get("x-internal-secret") !== secret) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**Long-running route escape hatch** (line 54):
```typescript
// The sync fans out to the Strava API + S3/Dynamo; give it room beyond the default.
export const maxDuration = 300;
```
⚠️ Landmine already documented in the terragrunt unit: `lambda_timeout` MUST be `>= maxDuration`
(strava-sync-scheduler terragrunt.hcl lines ~118-121) or the scheduler retry overlaps the next run.

**Result envelope** (lines 43–48): `NextResponse.json({ ok: true, ...result })` on success,
`{ error }` + 500 on throw.

---

### 3. Builder service `lib/heatmap-build.ts` (service, batch)

**Analogs:** `aggregate/route.ts` (the scan + S3-read fan-out) and
`apps/run.gpx/webapp/src/lib/gpx-reconcile.ts` (the con-day filter + injectable-deps testing seam).

**Con-day run selection — this is the HEAT-02 source query.** From `gpx-reconcile.ts:102-106`:
```typescript
const files = await listFiles(oidcSub);
const runs = files.filter(
  (f) => f.status === "active" && f.conDay && f.userId !== "GLOBAL"
);
```
That version is per-user (`GpxFile.query.primary({ userId: sub })`, line 68). The heatmap
builder needs ALL users → use the **scan** form from `aggregate/route.ts:37-42`:
```typescript
const scan = await GpxFile.scan
  .where((attr, op) => `${op.eq(attr.includeInAggregate, true)} AND ${op.eq(attr.status, "active")}`)
  .go({ pages: "all" });
```
⚠️ **HEAT-06 delta:** drop the `includeInAggregate` predicate entirely (user decision), keep
`status === "active"`, add `conDay` present + `userId !== "GLOBAL"`.

**`conDay` field definition** — `apps/run.gpx/webapp/src/entities/gpx-file.ts:176-184`:
```typescript
// Con-day tag (Phase 58): the ISO calendar date (YYYY-MM-DD) of the DEF CON
// run day this route was run on, always one of CON_DAYS[].date (see lib/con-days.ts).
conDay: { type: "string", required: false },
```
Related: `entities/route.ts:20` — "a run is a GpxFile with a conDay; a Route has NO conDay".
So "con-day-assigned runs" == `GpxFile` rows with a non-empty `conDay`. Year selection
(dc33 vs dc34) comes from the conDay date prefix / `lib/con-days.ts`.

**S3 track geometry read** — `gpx-reconcile.ts:72-75` (bucket+key live ON the GpxFile row):
```typescript
async function defaultLoadGpx(bucket: string, key: string): Promise<string> {
  const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return (await obj.Body?.transformToString()) ?? "";
}
```
Key shape helpers: `apps/run.gpx/webapp/src/lib/s3-client.ts` exports `BUCKET` (line 28),
`getUserPrefix(userId)` (line 33), `getRouteKey(routeId)` (line 45). The heatmap **artifact**
write should use a new dedicated key prefix, not a user prefix.

**GPX → points + distance (for `totalKm`)** — `lib/gpx-accomplishment.ts:65-93` `parseTrack`
returns `{ points: [lat,lon][], distance /* meters, haversine-summed */, elevation }`.
Use `distance` to accumulate `meta.totalKm`. ⚠️ `parseTrack` emits **[lat, lon]**; GeoJSON
needs **[lon, lat]** — either swap or use `trkptCoords` from `aggregate/route.ts:22-33`
which already emits GeoJSON order.

**Downsampling** — `gpx-accomplishment.ts:104-117` `decimatePolyline(points, max=100)`, even-stride,
always keeps first+last. It emits `{lat,lng}` objects, so it is NOT drop-in for GeoJSON; the
algorithm (lines 111-116) is what to copy if artifact size needs bounding.

**Injectable-deps testing seam** — `gpx-reconcile.ts:89-100`:
```typescript
export async function reconcileAccomplishments(
  oidcSub: string,
  deps?: {
    fetchImpl?: typeof fetch;
    listFiles?: (sub: string) => Promise<GpxFileRow[]>;
    loadGpx?: (bucket: string, key: string) => Promise<string>;
  }
) {
  const listFiles = deps?.listFiles ?? defaultListFiles;
  const loadGpx = deps?.loadGpx ?? defaultLoadGpx;
```
This is the repo's established way to make a batch service unit-testable — mirror it.

**⚠️ NO ANALOG for the S3 artifact WRITE.** No route/service in `apps/run.gpx/webapp/src`
writes a computed artifact to S3 today (`PutObjectCommand` in this app appears only in
`scripts/import-dc33.ts:17`). The planner should specify the `PutObjectCommand` call
explicitly (bucket, key, `ContentType: "application/json"`), using the script's import as
the only in-repo precedent.

**Bounding / logging cap** — `aggregate/route.ts:20, 44-49`:
```typescript
const MAX_ROUTES = 500; // bound on-demand cost; log if exceeded
...
console.warn(`[aggregate] ${scan.data.length} opted-in routes; capped at ${MAX_ROUTES} — precompute recommended`);
```
A precomputed artifact should raise or drop this cap — but keep the `[tag] …` console prefix convention.

---

### 4. Scheduled builder — Lambda + EventBridge (config, event-driven)

**Analogs (read in full):**
- `infra/terraform/modules/strava-sync-scheduler/v1.1.0/main.tf`
- `infra/terraform/modules/strava-sync-scheduler/v1.1.0/iam.tf`
- `infra/terraform/modules/strava-sync-scheduler/v1.1.0/lambda/index.mjs`
- `infra/terraform/live/site/region/us-east-1/strava-sync-scheduler/terragrunt.hcl`

**The architecture to copy: the Lambda is a thin INVOKER, not the worker.**
`lambda/index.mjs` lines 1–36 — no bundler, no npm deps, only the SDK in the runtime:
```javascript
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
const ssm = new SSMClient({});
export const handler = async () => {
  const syncUrl = process.env.SYNC_URL;
  const secretPath = process.env.INTERNAL_SYNC_SECRET_SSM_PATH;
  if (!syncUrl || !secretPath) throw new Error("SYNC_URL and INTERNAL_SYNC_SECRET_SSM_PATH are required");
  const param = await ssm.send(new GetParameterCommand({ Name: secretPath, WithDecryption: true }));
  const secret = param.Parameter?.Value;
  if (!secret) throw new Error(`secret not found at ${secretPath}`);
  const res = await fetch(syncUrl, { method: "POST", headers: { "x-internal-secret": secret } });
  const body = await res.text();
  console.log(`[strava-sync] ${res.status} ${body.slice(0, 500)}`);
  if (!res.ok) throw new Error(`sync endpoint returned ${res.status}`);
  return { statusCode: res.status, body };
};
```
**Consequence for HEAT-03:** the Lambda gets NO DynamoDB or S3 access. Those permissions
already exist on the run.gpx ECS task role, which is what actually does the work. This is
strictly simpler than a fat Lambda and is what the planner should choose.

**Lambda + zip + log group** — `main.tf` `data "archive_file" "sync"` / `aws_lambda_function "sync"`
(`handler = "index.handler"`, `source_code_hash = data.archive_file.sync.output_base64sha256`,
`tracing_config { mode = "Active" }`, `depends_on` the IAM policy + log group).

**Optional VPC attach — load-bearing here.** `main.tf`:
```hcl
dynamic "vpc_config" {
  for_each = length(var.vpc_subnet_ids) > 0 ? [1] : []
  content {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }
}
```
The terragrunt header (lines 1–27) explains WHY, and it applies verbatim to the heatmap
builder: the internal route is only reachable at the Cloud Map private DNS name
(`http://run-gpx.app-${region_label}-${site_label}.local:3000`), the public ALB accepts 443
only from the CloudFront prefix list, so the Lambda MUST be in the VPC on the `http_only` SG
(self-referencing ingress on :3000) + `sshhttps` (egress).

**EventBridge Scheduler** — `main.tf`:
```hcl
resource "aws_scheduler_schedule" "sync" {
  for_each = var.schedules
  name     = "${local.function_name}-${each.key}"
  flexible_time_window { mode = "OFF" }
  schedule_expression          = each.value
  schedule_expression_timezone = var.schedule_expression_timezone
  state                        = var.schedule_enabled ? "ENABLED" : "DISABLED"
  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy { maximum_retry_attempts = 2 }
  }
}
```
Live inputs (terragrunt.hcl): `schedules = { morning = "cron(0 10 * * ? *)", evening = "cron(0 22 * * ? *)" }`,
`schedule_expression_timezone = "America/Los_Angeles"`. For the con-window hourly cadence use
the same `for_each` map with e.g. `cron(0 * * * ? *)` and the same PT timezone.

**IAM — the current grant, in full (iam.tf).** Two roles:
1. Lambda execution role: logs (`logs:CreateLogStream`, `logs:PutLogEvents` scoped to the log
   group arn), X-Ray, `ssm:GetParameter` on ONE parameter arn, `kms:Decrypt` on
   `data.aws_kms_alias.ssm.target_key_arn` with a `kms:EncryptionContext:PARAMETER_ARN`
   condition, plus `AWSLambdaVPCAccessExecutionRole` managed policy for ENIs.
   ⚠️ Documented landmine (iam.tf lines 3–7): *"kms:Decrypt identity-based policies match on
   the KEY arn, NOT the alias arn — scoping to the alias silently denies at runtime."*
2. Scheduler role: assumed by `scheduler.amazonaws.com`, policy = `lambda:InvokeFunction` on
   the function arn only.

**Re: the memory note about `scheduler:*` missing from the CI role** — that is about the
*deploy* role, not this module; nothing in `modules/strava-sync-scheduler/` grants it. Since
the strava unit is applied and live, the CI role currently does hold whatever `scheduler:*`
it needs. The planner should treat this as "verify on first plan", not as a change to make.

**Terragrunt live-unit skeleton** (`live/site/region/us-east-1/strava-sync-scheduler/terragrunt.hcl`):
`include "skip"` + `exclude { if = include.skip.locals.should_skip }`, `include "module"` →
`modules/<name>/config.hcl`, `include "providers"` → `regional.hcl`, `terraform { source = "${include.module.locals.module_path}/v1.1.0" }`,
`dependency "network"` with `mock_outputs`, then `inputs = merge(include.module.locals.merged_inputs, {...})`.
⚠️ **HEADER LANDMINE quoted in the file:** the unit MUST live under `region/us-east-1/` so
`config.hcl`'s `find_in_parent_folders("region.hcl")` resolves `region.{label,full}`.
⚠️ Validate with a scoped `terragrunt plan` / the `terragrunt-plan.yml` GH Action — never a local apply.

---

### 5. DC33 one-off backfill script

**Analog:** `apps/run.gpx/webapp/scripts/import-dc33.ts` (the closest possible match — it is
literally the previous DC33 import).

**Header doc + invocation contract** (lines 1–16) — copy this shape exactly, it is how ops
scripts in this repo declare their creds:
```
 * Ops script — run with the run-gpx app's AWS creds (from SSM) ... NOTE: the real table is
 * `run-gpx-electro` (the entity's "dc34-gpx" default is dev-only), the bucket is
 * `uploads-dc34-run-gpx-use1-<suffix>`, and the scoped run-gpx IAM user is PutItem-only on
 * the table — hence deterministic ids + `put` upserts, no reads.
 *   GITHUB_TOKEN=... DYNAMODB_TABLE=run-gpx-electro DYNAMODB_REGION=us-east-1 \
 *   DYNAMODB_ACCESS_KEY=... DYNAMODB_SECRET_KEY=... \
 *   S3_UPLOADS_BUCKET=... S3_UPLOADS_ACCESS_KEY=... S3_UPLOADS_SECRET_KEY=... \
 *   npx tsx scripts/import-dc33.ts
```
**Auth pattern (important, contradicts the prompt's assumption):** these scripts do NOT use
`AWS_PROFILE` / `TF_VAR_profile_prefix`. They take **explicit env-var access keys** consumed by
`src/lib/s3-client.ts` and the ElectroDB entity config. `env.local.sh` / `dc34-application`
is the *release/build* path (`apps/build.sh`), not the ops-script path. The DC33 backfill
should follow import-dc33.ts (explicit env creds + `npx tsx`), but it must ALSO read from a
foreign account's bucket (`s3://defcon.run.33.backup`, acct 427284555693) — there is **no
in-repo analog for cross-account S3 read**, so the planner must specify that client
separately. Note CONTEXT §specifics: the DC33 repo `.env` keys are dead and the
sudo-management SSO profile is ReadOnly-not-Admin on 481723467561.

**Imports + S3 write** (lines 17–21):
```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFolder } from "../src/entities/gpx-folder";
import { GpxFile } from "../src/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";
```
Sibling one-off scripts for style/idempotency reference (all `.mts`, all `npx tsx`):
`apps/run.human/webapp/scripts/backfill-mesh-radios.mts`, `migrate-ctf-answerhash.mts`,
`seed-ctf-dc34.mts`.

**Polyline decoding — NO decoder exists in this repo.** Grep for `polyline` across
`apps/run.gpx/webapp/src` and `apps/run.human/webapp/src` finds only:
- `src/lib/strava-sync.ts:38` — the type `map?: { summary_polyline?: string | null }`;
- `strava-sync.ts:622-637` `toStripActivities` — filters on and passes through
  `a.map!.summary_polyline` as an **opaque string**, never decoded server-side;
- `src/lib/gpx-accomplishment.ts:104` `decimatePolyline` — a *downsampler*, unrelated to
  Google encoded-polyline;
- no `@mapbox/polyline` / `polyline` npm dependency in `apps/run.gpx/webapp/package.json`.

So HEAT-04's decoder must be **ported from DC33's `route.ts`** (per CONTEXT canonical refs:
handles BOTH encoded-polyline and raw JSON coordinate arrays) or a dependency added. Say so
in the plan rather than pretending an analog exists.

**GPX geometry + bounds extraction** for the non-Strava DC33 uploads:
`import-dc33.ts:56-70` `boundsOf()` uses the same `<trkpt lat=… lon=…>` regex family.

---

### 6. `heatmap-layer.ts` (studio layer class, fetch-once + lazy toggle)

**Analog A — the data path:** `public-overlays.ts` `addAggregate()` (lines 520–559). This is
the closest existing thing to what heatmap-layer does, and should be the primary template.

Region-prefixed URL (lines 37–46) — **do not use a root-absolute `/api/...`**:
```typescript
// The studio is served under the region basePath (e.g. /use1/studio/app), but the API
// lives at /use1/api/... — so a root-absolute '/api/...' drops the region and 404s.
function regionPrefix(): string {
    if (typeof location === 'undefined') return '';
    const i = location.pathname.indexOf('/studio');
    return i > 0 ? location.pathname.slice(0, i) : '';
}
const AGGREGATE_URL = `${regionPrefix()}/api/gpx/public/aggregate`;
const AGGREGATE_LAYER = 'public-all-runners';
```
(`ghost-layer.ts:23`, `rabbit-layer.ts:13`, `egg-modal.ts:50` each re-derive the same helper —
copying it again is the established convention.)

Fetch → source → layer → restore, with silent failure (lines 521–550):
```typescript
private async addAggregate() {
    try {
        const res = await fetch(AGGREGATE_URL, { credentials: 'omit' });
        if (!res.ok) return;
        const geojson = (await res.json()) as GeoJSON.FeatureCollection;
        if (!geojson.features || geojson.features.length === 0) return;

        if (!this.map.getSource(AGGREGATE_LAYER)) {
            this.map.addSource(AGGREGATE_LAYER, { type: 'geojson', data: geojson });
        }
        if (!this.map.getLayer(AGGREGATE_LAYER)) {
            this.map.addLayer({
                id: AGGREGATE_LAYER,
                type: 'line',
                source: AGGREGATE_LAYER,
                layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
                // Low opacity so overlapping tracks read as density (a soft heatmap).
                paint: { 'line-color': '#00e5ff', 'line-width': 2, 'line-opacity': 0.15 },
            });
        }
        // Restored in ONE store write (never "available, off" then "on"): the layer
        // control derives collapse from an ON/OFF transition, so a two-step restore
        // would read as a user toggle and rewrite the persisted collapse state.
        const visible = storedVisible(LAYER.aggregate, false);
        if (visible) this.map.setLayoutProperty(AGGREGATE_LAYER, 'visibility', 'visible');
        publicAggregate.set({ available: true, visible });
    } catch {
        // aggregate unavailable → no layer, studio unaffected
    }
}
```
⚠️ That `paint` block IS the "stacked translucent lines = heat" idea already shipped at
`#00e5ff / width 2 / opacity 0.15`. Phase 71's DC34 `#ff0000` and DC33 `#ff8c00` at ~0.25/width 3
are the same technique with per-year colors.

Toggle (lines 552–559) — three writes, always in this order:
```typescript
setAggregateVisible(visible: boolean) {
    if (this.map.getLayer(AGGREGATE_LAYER)) {
        this.map.setLayoutProperty(AGGREGATE_LAYER, 'visibility', visible ? 'visible' : 'none');
    }
    publicAggregate.update((s) => ({ ...s, visible }));
    setLayerVisible(LAYER.aggregate, visible);
}
```
Teardown (lines 1116–1117): `removeLayer` then `removeSource`, each guarded by a `get*` check.

**Analog B — the class shape / lazy-build:** `deuce-layer.ts` (327 lines, read in full).
Module-level id constants (lines 29–51), `built`/`visible` private flags (88–89),
style-readiness gate (95–98):
```typescript
private whenStyleReady(): Promise<void> {
    if (this.map.isStyleLoaded()) return Promise.resolve();
    return new Promise((resolve) => this.map.once('idle', () => resolve()));
}
```
and the lazy `setVisible` contract (276–299) — **note the race guard on line 280**:
```typescript
async setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) {
        if (!this.built) await this.build();
        if (!this.visible) return; // toggled off while style was loading
        this.setLayersVisible('visible');
        ...
    } else {
        this.setLayersVisible('none');
        ...
    }
}
```
Bulk visibility helper (270–274) and `remove()` (301–325) round out the required surface.

**Analog C — per-entry state store for the UI:** `community-routes.ts:39`
`export const communityRoutes = writable<CommunityRouteEntry[]>([])`, with the load committing
the entries **once, atomically** (line 196) after all fetches settle (lines 181–196), and
`setLayerPairVisible` used for restore instead of `setRouteVisible` (line 193 comment:
*"Raw layout property, never setRouteVisible: that fitBounds, and a restore must not move the
camera on page load"*). The heatmap layer wants the same: a
`writable<{ dc33: {...}, dc34: {...} }>` carrying `available / visible / generatedAt / runCount`.

**Persistence ids** — `$lib/stores/layer-visibility.ts:41-51`. Add to `LAYER`:
```typescript
export const LAYER = {
    checkins: 'checkins',
    aggregate: 'aggregate',
} as const;
```
→ add `heatDc33: 'heat:dc33'`, `heatDc34: 'heat:dc34'` (or a `PREFIX.heat` if data-driven).
Helpers available: `storedVisible(id, fallback)` (line 107), `setLayerVisible` (113),
`setLayersVisible` (118), `pruneLayerVisibility` (134). Storage key `dc34LayerVisibility` (line 38).

**Registration in the map** — `LayerControl.svelte` `map.onLoad` block, e.g. lines 333–338:
```svelte
if (deuceLayer) deuceLayer.remove();
deuceLayer = new DeuceLayer(_map);
deuceShown.subscribe((on) => {
    void deuceLayer?.setVisible(on);
    if (on) fireDeuceEgg();
});
```
with the leak note at lines 288–291: *"map.onLoad callbacks fire exactly once per component
lifetime … so this single subscription does not accumulate/leak."* Declare the instance
alongside `let deuceLayer: DeuceLayer | undefined;` (line 74).

---

### 7. HEAT MAP section in the Map Layers dialog (component, MODIFY)

**Analog:** `layer-control/PublicOverlays.svelte` (196 lines, read in full) — the canonical
Phase 70 section consumer. Create `layer-control/HeatMap.svelte` as its small sibling and
mount it in `LayerControl.svelte`'s `DialogShell`.

**Imports + props** (lines 11–17, 46):
```svelte
import { Section, Row, Chips, Chip } from '$lib/components/dialog-shell/index.js';
import { layerSectionCollapse, setSectionCollapsed, groupSection, SECTION } from '$lib/stores/layer-section-collapse';
...
let { layer }: { layer: PublicOverlaysLayer | undefined } = $props();
```
⚠️ Phase 70 landmine restated at lines 19–21: *"this component renders inside the portalled
dialog, whose subtree is destroyed on close, so a rune resets to its default on every reopen"*
— collapse/expand state MUST live in the persisted store, never in a local `$state`.

**Section with master toggle + hint + collapse** (lines 114–123) — the row to copy:
```svelte
<Section
    label="User Check-ins"
    count={$publicCheckIns.count}
    master={$publicCheckIns.visible}
    onmaster={(v) => layer?.setCheckInsVisible(v)}
    collapsed={$layerSectionCollapse[SECTION.checkins] ?? !$publicCheckIns.visible}
    ontoggle={(c) => setSectionCollapsed(SECTION.checkins, c)}
    hint="Public check-ins from runners on the mesh."
>
```
**Toggle rows bound to layer visibility** (lines 187–193) — the `🔥 DC34` / `🔥 DC33` rows:
```svelte
<Row
    checked={m.visible}
    onchange={(v) => layer?.setRouteVisible(m.fileId, v)}
    color={m.color}
    label={m.title || prettyRouteName(m.fileName)}
    hint={m.shortDescription}
/>
```
`color` renders the swatch — pass `#ff0000` / `#ff8c00` so the dialog row matches the map line.

**The "last calculated" trailing slot.** `Row.svelte` (`dialog-shell/Row.svelte:4-25`) props:
```typescript
control?: 'checkbox' | 'radio' | 'none';
name?; checked?; onchange?; color?; icon?: Snippet;
label: string; meta?: string; hint?: string; trailing?: Snippet;
```
→ **`trailing` is a Snippet** (use for a per-row stamp), while **`meta` is a plain string**.
`Section.svelte:8-32` has NO `trailing` prop — its slots are `count?: number | string` and
`menu?: Snippet`. So the CONTEXT's "section trailing slot shows relative 'last calculated'"
maps concretely to **`count={"42m ago"}`** (it accepts a string, rendered at
`Section.svelte:78-80` in a mono muted span) or to the `menu` snippet. The planner must pick
one; `count` as a string is the lower-risk read of the spec.
⚠️ `Section.svelte:34` — `const showChevron = $derived(collapsible && !!children)`; a Section
with no children renders no chevron (see the `collapsible={false}` "All Runners" usage at lines 105–111).

**Hint bar wiring.** `HintBar.svelte` takes `{ text }` and every hint reaches it via the
`data-hint` attribute set on the element (`Section.svelte:40`, `Row.svelte:32-33`):
```svelte
<label data-layer-row data-hint={hint} ...>
```
So "hint bar shows exact timestamp + run count on hover" == pass a `hint` string like
`"Last built 2026-08-07 14:03 PT · 412 runs"` to the `Row`/`Section` — no direct HintBar import.

**Section collapse id.** `$lib/stores/layer-section-collapse.ts:30-36`:
```typescript
export const SECTION = {
    basemap: 'basemap', overlays: 'overlays', checkins: 'checkins',
    myConRuns: 'myconruns', community: 'community',
} as const;
```
→ add `heatmap: 'heatmap'`.

**Mounting in the dialog** — `LayerControl.svelte:511-522`, note the guard convention:
```svelte
<!-- Each child below emits its own top-level section card(s), so there is no
     wrapper and no hand-written label here. The guards ARE the
     "empty sections stay hidden" behavior. -->
{#if $publicOverlayGroups.length > 0 || $publicAggregate.available}
    <PublicOverlays layer={publicOverlaysLayer} />
{/if}
{#if $myConRunGroups.length > 0}
    <MyConRuns layer={myConRunsLayer} />
{/if}
```
→ add `{#if $heatmapState.dc33.available || $heatmapState.dc34.available}<HeatMap layer={heatmapLayer} />{/if}`.

---

### 8. HEAT-06 — aggregate-route compliance comment (MODIFY)

**Exact current text**, `apps/run.gpx/webapp/src/app/api/gpx/public/aggregate/route.ts` lines 6–17:
```typescript
/**
 * GET /api/gpx/public/aggregate - Public, UNAUTHENTICATED "All Runners" aggregate (Phase 32).
 *
 * Returns a single blended, NON-ATTRIBUTABLE GeoJSON of every route whose owner opted in
 * (`includeInAggregate:true`). Each track is a bare LineString with NO properties — no name,
 * no id, no user — so nothing is individually identifiable. The studio renders it as one
 * low-opacity "All Runners" layer (overlap = density). This is the only public surface
 * permitted for Strava-derived routes (per the compliance model).
 *
 * NOTE: builds on-demand with a short cache. At larger scale, precompute to an S3 artifact
 * on the Phase 31b scheduler and serve that instead (see PHASE-31B-STRAVA.md).
 */
```
The load-bearing sentence to rewrite is **lines 12–13**: *"This is the only public surface
permitted for Strava-derived routes (per the compliance model)."* — now false, since Phase 71
adds `/api/gpx/public/heatmap/[year]` as a second non-attributable public surface that
includes Strava-derived geometry with **no** `includeInAggregate` opt-in.

**Related comments that tell the OLD story and should be checked for consistency**
(`entities/gpx-file.ts`):
- lines 158–161 — `source` provenance: *"'strava' = raw Strava import (NOT publicly shareable until converted)"*
- lines 165–168 — `publicShareEligible`: *"Compliance gate (Strava API terms): raw Strava imports are false and cannot enter the public groups…"*
- lines 170–174 — `includeInAggregate`: *"Opt-in to the public non-attributable 'All Runners' aggregate overlay (Phase 32). Owner-controlled…"*

The heatmap builder ignores all three gates. HEAT-06's edit should note that the non-attributable
heatmap is exempt (bare geometry, zero properties) so future readers don't "fix" the builder
back into an opt-in filter.

---

## Shared Patterns

### Silent-failure discipline in the studio
**Source:** `public-overlays.ts:547-549`, `community-routes.ts:148-151`, `:175-178`
**Apply to:** every fetch in `heatmap-layer.ts`
A failed/empty artifact fetch must leave the studio untouched — `catch {}` + return, optionally
`console.warn('[heatmap] …')`. Never throw into the map.

### Fire-and-forget / never-block-the-user
**Source:** `gpx-reconcile.ts:163-170` `reconcileBestEffort`
**Apply to:** any place a heatmap rebuild is triggered from a user mutation path.

### `[tag] message` console convention
**Source:** `aggregate/route.ts:47` `[aggregate]`, `community-routes.ts:176` `[community-routes]`,
`lambda/index.mjs:31` `[strava-sync]`
**Apply to:** all new files → `[heatmap]`.

### Internal service-to-service auth
**Source:** `api/gpx/internal/strava-sync/route.ts:21-26`
**Apply to:** the heatmap builder route. Header `x-internal-secret`,
`INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET`, 403 on mismatch.

### Persisted-visibility restore is a SINGLE atomic store write
**Source:** `public-overlays.ts:541-546`, `community-routes.ts:181-196` (+ `PublicOverlays.svelte:56-68`)
**Apply to:** heatmap layer load. A two-step "available-then-visible" restore is read by the
section as a user toggle and corrupts the persisted collapse state.

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| S3 artifact **write** from the webapp | service | file-I/O | No route/service in `apps/run.gpx/webapp/src` calls `PutObjectCommand` for a computed artifact; only `scripts/import-dc33.ts:17` imports it. Planner must specify bucket/key/ContentType explicitly. |
| Encoded-polyline **decoder** | utility | transform | No `@mapbox/polyline`-class dependency and no decode function anywhere in `apps/run.gpx` or `apps/run.human`. `summary_polyline` is only ever stored/passed as an opaque string (`strava-sync.ts:38, 622-637`). Port from DC33's `route.ts` per CONTEXT, or add a dep. |
| **Cross-account** S3 read (`s3://defcon.run.33.backup`, acct 427284555693) | script | file-I/O | `s3-client.ts` builds one client from single-account env creds; nothing reads another account's bucket. Credentials strategy is an open planning question (CONTEXT §specifics flags the DC33 keys as dead and the SSO profile as ReadOnly). |
| DynamoDB **export (DYNAMODB_JSON, gz)** reader | script | file-I/O | No script in the repo parses an AWS DDB export. `import-dc33.ts` reads GPX files from the GitHub API instead. New code. |

## Metadata

**Analog search scope:** `apps/run.gpx/webapp/src/{app/api,lib,entities,scripts}`,
`apps/run.gpx/gpx-studio/website/src/lib/{components/map,components/dialog-shell,stores}`,
`apps/run.human/webapp/scripts`, `infra/terraform/{modules,live/site/region/us-east-1}`
**Files read in full:** 10 (aggregate/route.ts, deuce-layer.ts, community-routes.ts,
Section.svelte, HintBar.svelte, PublicOverlays.svelte, strava-sync-scheduler main.tf/iam.tf/index.mjs,
strava-sync-scheduler terragrunt.hcl) + targeted ranges in 8 more
**Pattern extraction date:** 2026-07-30
