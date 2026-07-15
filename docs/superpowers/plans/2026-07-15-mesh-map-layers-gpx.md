# Mesh Map Layers (Rabbit Layer + Ghost Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two live Meshtastic-fed Mapbox layers to gpx-studio — a public opt-in "Rabbit Layer" (real attendees who toggle *Show me on the map*) and a hidden `!!!`-unlocked "Ghost mode" (simulated lore ghosts) — both fed from meshtk's `nodes.json` through server-side filtering proxies in run.gpx.

**Architecture:** meshtk writes an internal `nodes.json` (object keyed by numeric node id). Two run.gpx server-side proxies fetch it and emit ready GeoJSON `FeatureCollection`s: the **ghost proxy** filters to `ghost/contest/operative` nodes; the **rabbit proxy** intersects nodes against run.human's internal opted-in `{nodeNum → identity}` feed. All transform/filter/identity logic lives server-side (vitest-tested); the studio layers are thin (fetch → register icons → `source.setData` → poll). A hidden trigger (`!!!` keyboard / rapid theme-toggle mobile) flips a store that shows the ghost layer.

**Tech Stack:** Next.js App Router (run.gpx/webapp, run.human/webapp), ElectroDB/DynamoDB (RunUser), SvelteKit + Mapbox GL JS (gpx-studio/website), vitest.

## Global Constraints

- **Node ≥ 22.12 for vitest** — run `nvm use 23.6.0` before any `npx vitest`/`npm test` (default v22.1.0 fails environmentally).
- **Studio has no test runner** — `gpx-studio/website` has no vitest. Studio-side tasks (layers, trigger, wiring) use **manual verification**; all unit-tested logic lives in the two webapp packages.
- **Trust boundary = the run.gpx proxies.** The full `nodes.json` (keys, metrics) and the `{nodeNum → identity}` map only ever live server-side. Proxies emit only presentation-safe fields. Never emit `pubkey`, `privkey`, `neighbors`, metrics, `mqttUsername`/`mqttPassword`, or radio `privateKey`/`publicKey`.
- **Node id intersection is numeric only:** `parseInt(nodeId.replace(/^!/,''),16) >>> 0`. Stored hex (`"!4359d0cc"`) is lowercase and NOT guaranteed zero-padded — never string-compare against `%08x` keys.
- **Fail-soft everywhere:** any upstream error → `200` with `{ "type":"FeatureCollection","features":[] }` (proxies) or `{ entries: [] }` (internal feed). The studio must never break if a feed is down.
- **Position in `nodes.json` is Meshtastic int-degrees** (int32 × 1e7): `lon = longitude/1e7`, `lat = latitude/1e7`.
- **Rabbit Layer is opt-in only:** only radios with `verified === true && showOnMap === true` may ever appear; default `showOnMap` is `false`.
- **DRY/YAGNI/TDD, frequent commits.** Branch already in a worktree on `gsd/phase-43-...`; commit per task.

## File structure

**run.gpx/webapp (proxies — vitest):**
- Create `src/lib/mesh-nodes.ts` — pure transforms (parse, ghost filter, position validity, int-deg→coord, numeric-id, ghost/rabbit FeatureCollection builders).
- Create `src/lib/ghost-identities.ts` — slug→persona map.
- Create `src/lib/mesh-nodes.test.ts` — vitest for the above.
- Create `src/app/api/gpx/public/ghosts/route.ts` — ghost proxy.
- Create `src/app/api/gpx/public/rabbits/route.ts` — rabbit proxy.

**run.human/webapp (Rabbit backend — vitest):**
- Modify `src/entities/run-user.ts` — add `showOnMap` to the radio map + `MeshtasticRadio` type + `sanitizeRadio` + `RunUserItem`.
- Modify `src/app/api/meshtastic-radios/route.ts` — PATCH accepts `showOnMap`.
- Create `src/app/api/internal/mesh-map/route.ts` — internal opted-in feed.
- Create `src/app/api/internal/mesh-map/route.test.ts` — vitest.
- Modify `src/components/profile/MeshtasticRadios.tsx` — "Show me on the map" toggle.

**gpx-studio/website (layers + trigger — manual verify):**
- Create `src/lib/components/map/ghost-layer.ts` — `GhostLayer`.
- Create `src/lib/components/map/rabbit-layer.ts` — `RabbitLayer`.
- Create `src/lib/stores/ghost.ts` — `ghostMode` store + `recordHit` detector.
- Create `src/lib/components/GhostTrigger.svelte` — keyboard/mobile trigger.
- Modify `src/lib/components/map/layer-control/LayerControl.svelte` — wire both layers + subscribe.

---

# STAGE 1 — Ghost pipeline (proves feed → proxy → layer → trigger)

### Task 1: Pure mesh-node transforms + ghost identities

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/mesh-nodes.ts`
- Create: `apps/run.gpx/webapp/src/lib/ghost-identities.ts`
- Test: `apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts`

**Interfaces:**
- Produces: `type NodeDb = Record<string, MeshNode>`; `isGhost(n)`, `hasValidPosition(n)`, `lastSeen(n)`, `ghostSlug(longName)`, `coord(n): [lon,lat]`, `hexToNodeNum(nodeId): number`, `ghostFeatureCollection(db): FeatureCollection`, `rabbitFeatureCollection(db, entries: MeshMapEntry[]): FeatureCollection`, `type MeshMapEntry`. `ghostWho(slug): string` from ghost-identities.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts
import { describe, it, expect } from "vitest";
import {
  isGhost, hasValidPosition, lastSeen, ghostSlug, coord, hexToNodeNum,
  ghostFeatureCollection, rabbitFeatureCollection, type NodeDb,
} from "./mesh-nodes";

const ghost = {
  from: 2770627464, fromStr: "!a5246b88", longName: "ghost-condor-00",
  shortName: "GC00", latitude: 360817149, longitude: -1151727650,
  lastMapReport: 1754357652, batteryLevel: 71, privkey: "0xSECRET",
  pubkey: "0xSECRET", seenBy: { "msh/US/2/e/dc.run": 1754357652 },
};
const real = {
  from: 2503245760, fromStr: "!95347fc0", longName: "elkentaro-09",
  shortName: "J09", latitude: 356303231, longitude: 1397374428,
  lastMapReport: 1754357805, seenBy: { "msh/US/2/e/dc.run": 1754357805 },
};
const noPos = { longName: "ghost-zero", latitude: 0, longitude: 0 };

describe("mesh-nodes", () => {
  it("detects ghosts by longName", () => {
    expect(isGhost(ghost)).toBe(true);
    expect(isGhost(real)).toBe(false);
    expect(isGhost({ shortName: "operative-1" } as any)).toBe(true);
  });
  it("gates invalid positions", () => {
    expect(hasValidPosition(real)).toBe(true);
    expect(hasValidPosition(noPos as any)).toBe(false);
    expect(hasValidPosition({ latitude: 1, longitude: 1 } as any)).toBe(false); // no name
  });
  it("converts int-degrees to [lon,lat]", () => {
    expect(coord(real)).toEqual([139.7374428, 35.6303231]);
  });
  it("derives ghost slug", () => {
    expect(ghostSlug("ghost-condor-00")).toBe("condor");
    expect(ghostSlug("operative_mudge")).toBe("mudge");
  });
  it("converts hex node id to numeric uint32 (no zero-pad assumption)", () => {
    expect(hexToNodeNum("!95347fc0")).toBe(2503245760);
    expect(hexToNodeNum("!ff")).toBe(255);
  });
  it("picks lastSeen from lastMapReport or max(seenBy)", () => {
    expect(lastSeen(real)).toBe(1754357805);
    expect(lastSeen({ seenBy: { a: 5, b: 9 } } as any)).toBe(9);
  });
  it("builds a ghost FeatureCollection and strips secrets + real nodes", () => {
    const db: NodeDb = { "2770627464": ghost as any, "2503245760": real as any, "9": noPos as any };
    const fc = ghostFeatureCollection(db);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-115.172765, 36.0817149] });
    expect(f.properties!.slug).toBe("condor");
    expect(f.properties!.who).toBe("Kevin Mitnick");
    expect(JSON.stringify(f)).not.toMatch(/SECRET|privkey|pubkey/);
  });
  it("intersects rabbits by numeric node id and emits identity", () => {
    const db: NodeDb = { "2503245760": real as any, "2770627464": ghost as any };
    const fc = rabbitFeatureCollection(db, [
      { nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit", pinIcon: "star", pinColor: "#00d4aa", hash: "abc" },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties!.displayName).toBe("rabbit_9f2a");
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [139.7374428, 35.6303231] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && nvm use 23.6.0 && npx vitest run src/lib/mesh-nodes.test.ts`
Expected: FAIL — `Cannot find module './mesh-nodes'`.

- [ ] **Step 3: Write the identity map**

```ts
// apps/run.gpx/webapp/src/lib/ghost-identities.ts
/** Ghost slug → persona for the reveal popup. Unknown slug → title-cased fallback. */
const IDENTITIES: Record<string, string> = {
  condor: "Kevin Mitnick",
  hopper: "Grace Hopper",
  turing: "Alan Turing",
  ladyada: "Limor Fried",
  mudge: "Peiter Zatko",
  goldstein: "Emmanuel Goldstein",
  dt: "The Dark Tangent",
  gibson: "Gibson",
  sharp: "Sharp",
  ricky: "Ricky",
  bigstar: "Big Star",
};

export function ghostWho(slug: string): string {
  return (
    IDENTITIES[slug] ??
    slug.replace(/(^|[-_])([a-z])/g, (_m, sep, c) => (sep ? " " : "") + c.toUpperCase())
  );
}
```

- [ ] **Step 4: Write the transforms**

```ts
// apps/run.gpx/webapp/src/lib/mesh-nodes.ts
import { ghostWho } from "./ghost-identities";

export type MeshNode = {
  from?: number;
  fromStr?: string;
  longName?: string;
  shortName?: string;
  latitude?: number;
  longitude?: number;
  lastMapReport?: number;
  batteryLevel?: number;
  seenBy?: Record<string, number>;
  [k: string]: unknown;
};
export type NodeDb = Record<string, MeshNode>;

export type MeshMapEntry = {
  nodeNum: number;
  displayName: string;
  userType?: string;
  pinIcon?: string;
  pinColor?: string;
  hash?: string;
};

const GHOST_RE = /ghost|contest|operative/i;

export function isGhost(n: MeshNode): boolean {
  return GHOST_RE.test(n.longName ?? "") || GHOST_RE.test(n.shortName ?? "");
}

/** Mirrors meshtk IsValid: present name + non-zero position. */
export function hasValidPosition(n: MeshNode): boolean {
  return (
    !!n.longName &&
    typeof n.latitude === "number" &&
    typeof n.longitude === "number" &&
    n.latitude !== 0 &&
    n.longitude !== 0
  );
}

export function lastSeen(n: MeshNode): number {
  if (typeof n.lastMapReport === "number") return n.lastMapReport;
  const vals = Object.values(n.seenBy ?? {});
  return vals.length ? Math.max(...vals) : 0;
}

/** "ghost-condor-00" → "condor"; "operative_mudge" → "mudge". */
export function ghostSlug(longName: string): string {
  const m = longName.toLowerCase().match(/(?:ghost|contest|operative)[-_]?([a-z0-9]+)/);
  return m?.[1] ?? longName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function coord(n: MeshNode): [number, number] {
  return [(n.longitude as number) / 1e7, (n.latitude as number) / 1e7];
}

/** Numeric uint32 key from stored hex "!4359d0cc" (never assumes zero-padding). */
export function hexToNodeNum(nodeId: string): number {
  return parseInt(nodeId.replace(/^!/, ""), 16) >>> 0;
}

function keyToNum(key: string, n: MeshNode): number {
  const fromKey = Number(key);
  if (Number.isFinite(fromKey) && fromKey > 0) return fromKey >>> 0;
  return n.fromStr ? hexToNodeNum(n.fromStr) : 0;
}

export function ghostFeatureCollection(db: NodeDb): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    if (!isGhost(n) || !hasValidPosition(n)) continue;
    const slug = ghostSlug(n.longName as string);
    features.push({
      type: "Feature",
      id: keyToNum(key, n),
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        slug,
        who: ghostWho(slug),
        shortName: n.shortName ?? "",
        lastSeen: lastSeen(n),
        battery: typeof n.batteryLevel === "number" ? n.batteryLevel : -1,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export function rabbitFeatureCollection(
  db: NodeDb,
  entries: MeshMapEntry[]
): GeoJSON.FeatureCollection {
  const byNum = new Map<number, MeshMapEntry>();
  for (const e of entries) byNum.set(e.nodeNum >>> 0, e);
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    const num = keyToNum(key, n);
    const id = byNum.get(num);
    if (!id || !hasValidPosition(n)) continue;
    features.push({
      type: "Feature",
      id: num,
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        displayName: id.displayName || "a rabbit",
        userType: id.userType ?? "",
        pinIcon: id.pinIcon ?? "",
        pinColor: id.pinColor ?? "",
        hash: id.hash ?? "",
        lastSeen: lastSeen(n),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/mesh-nodes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/run.gpx/webapp/src/lib/mesh-nodes.ts apps/run.gpx/webapp/src/lib/ghost-identities.ts apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts
git commit -m "feat(gpx): pure mesh-node transforms + ghost identities"
```

---

### Task 2: Ghost proxy route

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/route.test.ts`

**Interfaces:**
- Consumes: `ghostFeatureCollection`, `type NodeDb` from `@/lib/mesh-nodes`.
- Produces: `GET()` → `NextResponse` JSON FeatureCollection. Env `GHOST_FEED_URL`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/route.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

const ghost = {
  longName: "ghost-condor-00", shortName: "GC00",
  latitude: 360817149, longitude: -1151727650, privkey: "0xSECRET",
};

afterEach(() => vi.restoreAllMocks());

describe("ghost proxy", () => {
  it("returns a ghost FeatureCollection from the feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ "1": ghost }),
    })));
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/SECRET/);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });
  it("fails soft to an empty collection on upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body).toEqual({ type: "FeatureCollection", features: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/ghosts/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Write the route**

```ts
// apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/route.ts
import { NextResponse } from "next/server";
import { ghostFeatureCollection, type NodeDb } from "@/lib/mesh-nodes";

/**
 * GET /api/gpx/public/ghosts — the "ghost proxy" (trust boundary).
 * Server-side fetches meshtk's INTERNAL nodes.json, filters to ghost/contest/
 * operative nodes, strips all keys/metrics, and emits a ready GeoJSON
 * FeatureCollection. Hidden ghost-mode layer polls this. Fail-soft: any error → [].
 */
const GHOST_FEED_URL = process.env.GHOST_FEED_URL || "http://localhost:3005/nodes.json";
const CACHE_SECONDS = 60;
const EMPTY = { type: "FeatureCollection", features: [] as GeoJSON.Feature[] };

function json(fc: unknown) {
  return NextResponse.json(fc, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
    },
  });
}

export async function GET() {
  try {
    const res = await fetch(GHOST_FEED_URL, { cache: "no-store" });
    if (!res.ok) return json(EMPTY);
    const db = (await res.json()) as NodeDb;
    return json(ghostFeatureCollection(db));
  } catch (error) {
    console.error("ghost proxy error:", error);
    return json(EMPTY);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/ghosts/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/
git commit -m "feat(gpx): ghost proxy route (nodes.json → filtered GeoJSON)"
```

---

### Task 3: GhostLayer (studio)

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts`

**Interfaces:**
- Consumes: `mapboxgl` (`mapbox-gl`).
- Produces: `class GhostLayer { constructor(map); setVisible(v: boolean): Promise<void>; remove(): void }`.
- Fetches `${regionPrefix}/api/gpx/public/ghosts`.

- [ ] **Step 1: Write the layer** (no unit test — studio has no runner; verified manually in Task 5)

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts
import mapboxgl from 'mapbox-gl';

const SOURCE = 'dc34-ghosts';
const LAYER = 'dc34-ghosts-pins';
const IMAGE = 'dc34-ghost-icon';
const POLL_MS = 90_000;

/** Region prefix = path before '/studio' (mirrors public-overlays regionPrefix). */
function ghostUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/ghosts`;
}

// Spooky ghost silhouette (Pac-Man-style wisp) in DC34 violet.
const GHOST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M4 20V11a8 8 0 0 1 16 0v9l-2.7-1.6L14.6 20 12 18.4 9.4 20 6.7 18.4z"
        fill="#9b5de5" stroke="#e0aaff" stroke-width="0.8" opacity="0.9"/>
  <circle cx="9.4" cy="10" r="1.3" fill="#101015"/>
  <circle cx="14.6" cy="10" r="1.3" fill="#101015"/>
</svg>`;

export class GhostLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 14, className: 'dc34-ghost-popup' });
    private timer: ReturnType<typeof setInterval> | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private loadImage() {
        if (this.map.hasImage(IMAGE)) return;
        const img = new Image(64, 64);
        img.onload = () => { if (!this.map.hasImage(IMAGE)) this.map.addImage(IMAGE, img); };
        img.src = 'data:image/svg+xml,' + encodeURIComponent(GHOST_SVG);
    }

    private async build() {
        await this.whenStyleReady();
        this.loadImage();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER, type: 'symbol', source: SOURCE,
                layout: {
                    visibility: 'none',
                    'icon-image': IMAGE, 'icon-size': 0.7, 'icon-allow-overlap': true, 'icon-anchor': 'bottom',
                    'text-field': ['get', 'shortName'], 'text-size': 10,
                    'text-offset': [0, 0.6], 'text-anchor': 'top', 'text-allow-overlap': true,
                },
                paint: { 'icon-opacity': 0.9, 'text-color': '#e0aaff', 'text-halo-color': '#101015', 'text-halo-width': 1 },
            });
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as { who?: string; shortName?: string };
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(`<div class="dc34-ghost-reveal"><strong>${p.who ?? 'a ghost'}</strong><br><span>${p.shortName ?? ''}</span></div>`)
                    .addTo(this.map);
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(ghostUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) src.setData(fc);
        } catch {
            // keep last frame
        }
    }

    async setVisible(visible: boolean) {
        if (visible) {
            if (!this.built) await this.build();
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'visible');
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'none');
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    }

    remove() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.clickFn) { this.map.off('click', LAYER, this.clickFn); this.clickFn = null; }
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
```

- [ ] **Step 2: Type-check the studio build**

Run: `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error --diagnostic-sources js 2>&1 | tail -20`
Expected: no new errors referencing `ghost-layer.ts` (pre-existing warnings unrelated are OK).

- [ ] **Step 3: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts
git commit -m "feat(gpx-studio): GhostLayer (thin polling Mapbox layer)"
```

---

### Task 4: ghostMode store + GhostTrigger

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/stores/ghost.ts`
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/GhostTrigger.svelte`

**Interfaces:**
- Produces: `ghostMode: Writable<boolean>`; `recordHit(buf: number[], now: number, windowMs?: number, threshold?: number): { hit: boolean; buf: number[] }`.

- [ ] **Step 1: Write the store + detector**

```ts
// apps/run.gpx/gpx-studio/website/src/lib/stores/ghost.ts
import { writable } from 'svelte/store';

/** Whether hidden ghost mode is active. */
export const ghostMode = writable(false);

/**
 * Rolling-window gesture detector (ported from run.human EggTrigger). Records a
 * hit at `now`, drops hits older than the window, and reports a trigger once the
 * count reaches the threshold (clearing the buffer so a later burst re-fires).
 */
export function recordHit(
    buf: number[],
    now: number,
    windowMs = 1200,
    threshold = 3
): { hit: boolean; buf: number[] } {
    const next = [...buf, now].filter((t) => now - t <= windowMs);
    if (next.length >= threshold) return { hit: true, buf: [] };
    return { hit: false, buf: next };
}
```

```svelte
<!-- apps/run.gpx/gpx-studio/website/src/lib/components/GhostTrigger.svelte -->
<!--
  Hidden trigger for ghost mode. Keyboard: three '!' within 1200ms toggles it.
  Mobile: four rapid theme flips within 2000ms toggles it (the DC33 gesture) —
  we watch the mode-watcher `mode` store rather than a specific button.
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import { mode } from 'mode-watcher';
    import { ghostMode, recordHit } from '$lib/stores/ghost';

    onMount(() => {
        let keyBuf: number[] = [];
        let themeBuf: number[] = [];

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '!') { keyBuf = []; return; }
            const r = recordHit(keyBuf, Date.now());
            keyBuf = r.buf;
            if (r.hit) ghostMode.update((v) => !v);
        };
        window.addEventListener('keydown', onKey);

        // mode.current flips on each theme toggle; count rapid flips.
        let firstMode = true;
        const unsub = mode.subscribe(() => {
            if (firstMode) { firstMode = false; return; } // ignore initial value
            const r = recordHit(themeBuf, Date.now(), 2000, 4);
            themeBuf = r.buf;
            if (r.hit) ghostMode.update((v) => !v);
        });

        return () => {
            window.removeEventListener('keydown', onKey);
            unsub();
        };
    });
</script>
```

- [ ] **Step 2: Type-check**

Run: `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: no new errors for `ghost.ts` / `GhostTrigger.svelte`. (If `mode-watcher`'s import path differs, confirm with `grep -rn "from 'mode-watcher'" src` and match the existing import — `ModeSwitch.svelte` uses it.)

- [ ] **Step 3: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/stores/ghost.ts apps/run.gpx/gpx-studio/website/src/lib/components/GhostTrigger.svelte
git commit -m "feat(gpx-studio): ghostMode store + hidden !!!/theme-toggle trigger"
```

---

### Task 5: Wire GhostLayer + trigger into the studio

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte:195-212` (the `map.onLoad` block)
- Modify: the studio root layout that renders the map UI (find with `grep -rln "LayerControl" apps/run.gpx/gpx-studio/website/src/routes apps/run.gpx/gpx-studio/website/src/lib` — mount `<GhostTrigger />` alongside it).

**Interfaces:**
- Consumes: `GhostLayer` (Task 3), `ghostMode` (Task 4).

- [ ] **Step 1: Instantiate GhostLayer and subscribe it to ghostMode**

In `LayerControl.svelte`, add to the `<script>` imports:

```ts
import { GhostLayer } from '$lib/components/map/ghost-layer';
import { ghostMode } from '$lib/stores/ghost';
```

Add a module-scope handle near the other layer handles (e.g. beside `publicOverlaysLayer`):

```ts
let ghostLayer: GhostLayer | undefined;
```

Extend the existing `map.onLoad((_map) => { ... })` block (currently lines ~195-212) — after `publicOverlaysLayer.add();`, add:

```ts
        if (ghostLayer) ghostLayer.remove();
        ghostLayer = new GhostLayer(_map);
        // Reveal/hide with the hidden ghostMode store (default off).
        ghostMode.subscribe((on) => {
            void ghostLayer?.setVisible(on);
        });
```

- [ ] **Step 2: Mount the trigger**

In the root layout/page that renders `<LayerControl ... />` (from the grep above), add the import and mount it once (it is headless):

```svelte
import GhostTrigger from '$lib/components/GhostTrigger.svelte';
...
<GhostTrigger />
```

- [ ] **Step 3: Build the studio and run it against a local ghost feed**

Follow the existing local overlay recipe (`docs`/memory `reference_gpx_overlay_local_verify` — studio dev `:5173` proxying the webapp API), with a stand-in `nodes.json`:

```bash
# Terminal A — a stand-in nodes.json feed with a real ghost node:
cp ~/working/meshtk/nodes.ghost.condor.json /tmp/nodes.json
cd /tmp && python3 -m http.server 3005          # http://localhost:3005/nodes.json
```

```bash
# Terminal B — run.gpx webapp (serves the /api proxy) with the feed url:
cd apps/run.gpx/webapp && GHOST_FEED_URL=http://localhost:3005/nodes.json PORT=3002 npm run dev
```

```bash
# Terminal C — build the studio (or run its vite dev server per the overlay recipe):
cd apps/run.gpx && ./build-frontend.sh
# then browse the built studio via the webapp, or use the studio dev server on :5173
```

- [ ] **Step 4: Manual verification**

1. Open the studio (`http://localhost:3002/use1/studio/app`, or the `:5173` dev server).
2. Confirm **no** ghost pin is visible initially.
3. Type `!` `!` `!` quickly → a violet ghost pin appears near Vegas (36.08, -115.17). Click it → popup reads **"Kevin Mitnick"** / `GC00`.
4. Type `!!!` again → the ghost disappears (toggle off).
5. In devtools Network, confirm a request to `/use1/api/gpx/public/ghosts` returns a FeatureCollection with **no** `privkey`/`pubkey`.

Expected: all five hold. If the pin doesn't appear, check the browser console and the `GHOST_FEED_URL` value.

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
git add -A apps/run.gpx/gpx-studio/website/src/routes apps/run.gpx/gpx-studio/website/src/lib
git commit -m "feat(gpx-studio): wire GhostLayer + trigger (ghost mode end-to-end)"
```

---

# STAGE 2 — Rabbit backend (run.human)

### Task 6: `showOnMap` field on the radio model

**Files:**
- Modify: `apps/run.human/webapp/src/entities/run-user.ts:79-98` (radio map), `:437-449` (`MeshtasticRadio` type), `:458-472` (`sanitizeRadio`), and `RunUserItem` (`:474+`).
- Test: `apps/run.human/webapp/src/entities/run-user.test.ts` (create if absent).

**Interfaces:**
- Produces: `MeshtasticRadio.showOnMap?: boolean`; `sanitizeRadio` returns `showOnMap: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.human/webapp/src/entities/run-user.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeRadio, type MeshtasticRadio } from "./run-user";

describe("sanitizeRadio showOnMap", () => {
  it("defaults showOnMap to false when absent", () => {
    const r = sanitizeRadio({ id: "a", nodeId: "!ff", verified: true } as MeshtasticRadio);
    expect(r.showOnMap).toBe(false);
  });
  it("preserves an explicit showOnMap", () => {
    const r = sanitizeRadio({ id: "a", nodeId: "!ff", verified: true, showOnMap: true } as MeshtasticRadio);
    expect(r.showOnMap).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && nvm use 23.6.0 && npx vitest run src/entities/run-user.test.ts`
Expected: FAIL — `showOnMap` is `undefined` (property not returned by `sanitizeRadio`).

- [ ] **Step 3: Add the field in three places**

In the entity map properties (after `impersonate: { type: "boolean" },` at line 88):

```ts
            impersonate: { type: "boolean" },
            showOnMap: { type: "boolean" },
```

In the `MeshtasticRadio` type (after `impersonate?: boolean;`):

```ts
  impersonate?: boolean;
  showOnMap?: boolean;
```

In `sanitizeRadio` (after the `impersonate` line):

```ts
    impersonate: radio.impersonate ?? false,
    showOnMap: radio.showOnMap ?? false,
```

In `RunUserItem` — confirm it declares `meshtasticRadios?: MeshtasticRadio[]` and `preferences?: { ...; pinIcon?: string; pinColor?: string }`. If `meshtasticRadios`/`preferences` are missing from `RunUserItem`, add them (they are needed by Task 8):

```ts
  preferences?: {
    theme?: string;
    units?: string;
    privacyLevel?: string;
    checkinPreference?: string;
    pinIcon?: string;
    pinColor?: string;
  };
  meshtasticRadios?: MeshtasticRadio[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run src/entities/run-user.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/entities/run-user.ts apps/run.human/webapp/src/entities/run-user.test.ts
git commit -m "feat(run.human): showOnMap flag on meshtastic radios"
```

---

### Task 7: PATCH accepts `showOnMap`

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts:189` (destructure) and `:241-243` (apply).

**Interfaces:**
- Consumes: `MeshtasticRadio.showOnMap` (Task 6).

- [ ] **Step 1: Add `showOnMap` to the PATCH destructure**

Change line 189 from:

```ts
    const { radioId, verificationCode, privateKey, publicKey, impersonate } = await req.json();
```

to:

```ts
    const { radioId, verificationCode, privateKey, publicKey, impersonate, showOnMap } = await req.json();
```

- [ ] **Step 2: Apply it alongside impersonate**

After the existing `impersonate` block (lines 241-243), add:

```ts
    if (impersonate !== undefined) {
      radio.impersonate = impersonate;
    }

    if (showOnMap !== undefined) {
      radio.showOnMap = showOnMap;
    }
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd apps/run.human/webapp && npx tsc --noEmit -p tsconfig.json 2>&1 | grep meshtastic-radios || echo "no type errors in route"`
Expected: `no type errors in route`.

- [ ] **Step 4: Commit**

```bash
git add apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts
git commit -m "feat(run.human): PATCH meshtastic-radios accepts showOnMap"
```

---

### Task 8: Internal opted-in mesh-map feed

**Files:**
- Create: `apps/run.human/webapp/src/app/api/internal/mesh-map/route.ts`
- Test: `apps/run.human/webapp/src/app/api/internal/mesh-map/route.test.ts`

**Interfaces:**
- Consumes: `scanAllRunUsers` from `@/entities/run-user`, `config.auth.internalSecret`.
- Produces: `GET(req)` → `{ entries: MeshMapEntry[] }` where entry = `{ nodeNum, displayName, userType?, pinIcon?, pinColor?, hash? }`. Gated on `x-internal-secret`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.human/webapp/src/app/api/internal/mesh-map/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/entities/run-user", () => ({
  scanAllRunUsers: vi.fn(),
}));
vi.mock("@/config", () => ({ config: { auth: { internalSecret: "s3cr3t" } } }));

import { scanAllRunUsers } from "@/entities/run-user";
import { GET } from "./route";

function req(secret?: string) {
  return { headers: { get: (k: string) => (k === "x-internal-secret" ? secret ?? null : null) } } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("internal mesh-map", () => {
  it("403s without the internal secret", async () => {
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
  it("returns only verified && showOnMap radios with numeric node ids", async () => {
    (scanAllRunUsers as any).mockResolvedValue([
      {
        displayName: "rabbit_9f2a", mqttUsertype: "rabbit", hash: "abc",
        preferences: { pinIcon: "star", pinColor: "#00d4aa" },
        meshtasticRadios: [
          { id: "1", nodeId: "!95347fc0", verified: true, showOnMap: true },
          { id: "2", nodeId: "!deadbeef", verified: true, showOnMap: false }, // opted out
          { id: "3", nodeId: "!12345678", verified: false, showOnMap: true }, // unverified
        ],
      },
      { displayName: "no_radios" },
    ]);
    const res = await GET(req("s3cr3t"));
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit",
      pinIcon: "star", pinColor: "#00d4aa", hash: "abc",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && npx vitest run src/app/api/internal/mesh-map/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Write the route**

```ts
// apps/run.human/webapp/src/app/api/internal/mesh-map/route.ts
import { NextRequest, NextResponse } from "next/server";
import { scanAllRunUsers } from "@/entities/run-user";
import { config } from "@/config";

/**
 * Internal API: opted-in Meshtastic map identities.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only). Returns one entry
 * per radio that is BOTH verified and showOnMap, mapping the numeric node id to
 * the user's public identity. Consumed by run.gpx's rabbit proxy, which
 * intersects these against meshtk's nodes.json. Opt-in only; default off.
 */
function hexToNodeNum(nodeId: string): number {
  return parseInt(nodeId.replace(/^!/, ""), 16) >>> 0;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const users = await scanAllRunUsers();
    const entries: Array<{
      nodeNum: number;
      displayName: string;
      userType?: string;
      pinIcon?: string;
      pinColor?: string;
      hash?: string;
    }> = [];
    for (const u of users) {
      for (const r of u.meshtasticRadios ?? []) {
        if (!r.verified || !r.showOnMap || !r.nodeId) continue;
        entries.push({
          nodeNum: hexToNodeNum(r.nodeId),
          displayName: u.displayName ?? "a rabbit",
          userType: u.mqttUsertype,
          pinIcon: u.preferences?.pinIcon,
          pinColor: u.preferences?.pinColor,
          hash: u.hash,
        });
      }
    }
    return NextResponse.json(
      { entries },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("mesh-map error:", error);
    return NextResponse.json({ entries: [] }, { status: 200 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run src/app/api/internal/mesh-map/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/app/api/internal/mesh-map/
git commit -m "feat(run.human): internal opted-in mesh-map feed (x-internal-secret)"
```

---

### Task 9: "Show me on the map" toggle UI

**Files:**
- Modify: `apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx` — add state, `handleToggleShowOnMap`, a `<Switch>`, and (if a local radio type exists) `showOnMap`.

**Interfaces:**
- Consumes: `PATCH /api/meshtastic-radios { radioId, showOnMap }` (Task 7).

- [ ] **Step 1: Add toggling state**

Near the existing `togglingImpersonateId` state declaration, add:

```tsx
  const [togglingShowOnMapId, setTogglingShowOnMapId] = useState<string | null>(null);
```

- [ ] **Step 2: Add the handler** (mirror `handleToggleImpersonate`, lines 305-337)

```tsx
  const handleToggleShowOnMap = async (radioId: string, currentValue: boolean) => {
    setTogglingShowOnMapId(radioId);
    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radioId, showOnMap: !currentValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to update radio');
        return;
      }
      setRadios(prev => prev.map(r =>
        r.id === radioId ? { ...r, showOnMap: !currentValue } : r
      ));
      onUpdate?.();
    } catch (err) {
      setError('Failed to update radio');
      console.error(err);
    } finally {
      setTogglingShowOnMapId(null);
    }
  };
```

- [ ] **Step 3: Add the Switch** next to the Impersonate switch (inside the `radio.verified && radio.privateKey` block, after the Impersonate `<div>`, lines ~603-614)

```tsx
                          <div className="flex items-center gap-1">
                            <Switch
                              size="sm"
                              color="success"
                              isSelected={radio.showOnMap ?? false}
                              isDisabled={togglingShowOnMapId === radio.id}
                              onValueChange={() => handleToggleShowOnMap(radio.id, radio.showOnMap ?? false)}
                            />
                            <span className="text-xs text-default-500">Show me on the map</span>
                          </div>
```

- [ ] **Step 4: Extend the component's radio type if it is local**

Run: `grep -n "impersonate" apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx | head`
If a local `interface`/`type` with `impersonate?: boolean` exists, add `showOnMap?: boolean;` beside it. (If the component imports `MeshtasticRadio` from the entity, Task 6 already covers it.)

- [ ] **Step 5: Manual verification**

```bash
cd apps/run.human/webapp && PORT=3001 npm run dev
```
1. Sign in, open `/use1/whoami`, scroll to the **Meshtastic** section on a **verified** radio.
2. Confirm a green **"Show me on the map"** switch appears next to **Impersonate**, default OFF.
3. Toggle it on → no error; reload → it stays on.
4. `curl -s -H "x-internal-secret: $AUTH_INTERNAL_SECRET" http://localhost:3001/api/internal/mesh-map | jq` → your node appears in `entries` with `nodeNum` + `displayName`. Toggle off, re-curl → it's gone.

Expected: all four hold.

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/components/profile/MeshtasticRadios.tsx
git commit -m "feat(run.human): 'Show me on the map' toggle on verified radios"
```

---

# STAGE 3 — Rabbit proxy + layer

### Task 10: Rabbit proxy route

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.test.ts`

**Interfaces:**
- Consumes: `rabbitFeatureCollection`, `type NodeDb` from `@/lib/mesh-nodes`. Env `GHOST_FEED_URL`, `RUN_HUMAN_INTERNAL_URL`/service discovery, `AUTH_INTERNAL_SECRET`.
- Produces: `GET()` → FeatureCollection of opted-in rabbits.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

const real = { longName: "elkentaro-09", shortName: "J09", latitude: 356303231, longitude: 1397374428 };

afterEach(() => vi.restoreAllMocks());

function stubFetch(nodes: any, mapBody: any, mapOk = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("mesh-map")) {
        return { ok: mapOk, json: async () => mapBody };
      }
      return { ok: true, json: async () => nodes };
    })
  );
}

describe("rabbit proxy", () => {
  it("emits only intersected opted-in rabbits", async () => {
    stubFetch(
      { "2503245760": real },
      { entries: [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinIcon: "star", pinColor: "#00d4aa" }] }
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.displayName).toBe("rabbit_9f2a");
  });
  it("fails soft when the internal feed errors", async () => {
    stubFetch({ "2503245760": real }, { entries: [] }, false);
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body).toEqual({ type: "FeatureCollection", features: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/rabbits/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Write the route** (RUN_HUMAN_URL block copied verbatim from `checkins/route.ts:12-23`)

```ts
// apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.ts
import { NextResponse } from "next/server";
import { rabbitFeatureCollection, type NodeDb, type MeshMapEntry } from "@/lib/mesh-nodes";

/**
 * GET /api/gpx/public/rabbits — the "rabbit proxy" (trust boundary).
 * Intersects meshtk's INTERNAL nodes.json with run.human's internal opted-in
 * mesh-map feed and emits a ready GeoJSON FeatureCollection with only public
 * identity fields. Only verified && showOnMap users appear. Fail-soft → [].
 */
const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";
const RUN_HUMAN_URL =
  process.env.RUN_HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(/\./g, "-")}.local:3000/${region}`);

const GHOST_FEED_URL = process.env.GHOST_FEED_URL || "http://localhost:3005/nodes.json";
const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";
const CACHE_SECONDS = 30;
const EMPTY = { type: "FeatureCollection", features: [] as GeoJSON.Feature[] };

function json(fc: unknown) {
  return NextResponse.json(fc, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
    },
  });
}

export async function GET() {
  try {
    const [nodesRes, mapRes] = await Promise.all([
      fetch(GHOST_FEED_URL, { cache: "no-store" }),
      fetch(`${RUN_HUMAN_URL}/api/internal/mesh-map`, {
        cache: "no-store",
        headers: { "x-internal-secret": INTERNAL_SECRET },
      }),
    ]);
    if (!nodesRes.ok || !mapRes.ok) return json(EMPTY);
    const db = (await nodesRes.json()) as NodeDb;
    const { entries } = (await mapRes.json()) as { entries: MeshMapEntry[] };
    return json(rabbitFeatureCollection(db, entries ?? []));
  } catch (error) {
    console.error("rabbit proxy error:", error);
    return json(EMPTY);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/rabbits/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/
git commit -m "feat(gpx): rabbit proxy route (nodes.json ∩ opted-in identities)"
```

---

### Task 11: RabbitLayer (studio) + wire default-on

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte` (`map.onLoad` block).

**Interfaces:**
- Consumes: `mapboxgl`, `pinSvg`, `pinIconById`, `DEFAULT_PIN_ICON`, `DEFAULT_PIN_COLOR` from `$lib/dc34-pins`.
- Produces: `class RabbitLayer { constructor(map); setVisible(v): Promise<void>; remove() }`.

- [ ] **Step 1: Write the layer** (per-feature pins mirror `checkinFeatures`/`loadSvgImage`)

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts
import mapboxgl from 'mapbox-gl';
import { pinSvg, pinIconById, DEFAULT_PIN_ICON, DEFAULT_PIN_COLOR } from '$lib/dc34-pins';

const SOURCE = 'dc34-rabbits';
const LAYER = 'dc34-rabbits-pins';
const POLL_MS = 45_000;

function rabbitUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/rabbits`;
}

export class RabbitLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({ closeButton: true, offset: 12, className: 'dc34-rabbit-popup' });
    private timer: ReturnType<typeof setInterval> | null = null;
    private clickFn: ((e: mapboxgl.MapMouseEvent) => void) | null = null;
    private built = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private whenStyleReady(): Promise<void> {
        if (this.map.isStyleLoaded()) return Promise.resolve();
        return new Promise((resolve) => this.map.once('idle', () => resolve()));
    }

    private loadSvgImage(id: string, svg: string) {
        if (this.map.hasImage(id)) return;
        const icon = new Image(100, 100);
        icon.onload = () => { if (!this.map.hasImage(id)) this.map.addImage(id, icon); };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    /** Register a branded pin per (icon,color) and stamp iconId onto each feature. */
    private register(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        for (const f of fc.features) {
            const p = (f.properties ?? {}) as { pinIcon?: string; pinColor?: string };
            const icon = pinIconById(p.pinIcon) ?? pinIconById(DEFAULT_PIN_ICON)!;
            const color = p.pinColor || DEFAULT_PIN_COLOR;
            const iconId = `rabbit-${icon.id}-${color}`;
            this.loadSvgImage(iconId, pinSvg(icon, color));
            (f.properties as Record<string, unknown>).iconId = iconId;
        }
        return fc;
    }

    private async build() {
        await this.whenStyleReady();
        if (!this.map.getSource(SOURCE)) {
            this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!this.map.getLayer(LAYER)) {
            this.map.addLayer({
                id: LAYER, type: 'symbol', source: SOURCE,
                layout: {
                    visibility: 'none',
                    'icon-image': ['get', 'iconId'], 'icon-size': 0.5,
                    'icon-anchor': 'bottom', 'icon-allow-overlap': true,
                    'text-field': ['get', 'displayName'], 'text-size': 10,
                    'text-offset': [0, 0.4], 'text-anchor': 'top',
                },
                paint: { 'text-color': '#e6007a', 'text-halo-color': '#101015', 'text-halo-width': 1 },
            });
            this.clickFn = (e) => {
                const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
                if (!f) return;
                const p = (f.properties ?? {}) as { displayName?: string; userType?: string };
                this.popup
                    .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
                    .setHTML(`<div class="dc34-rabbit-reveal"><strong>${p.displayName ?? 'a rabbit'}</strong>${p.userType ? `<br><span>${p.userType}</span>` : ''}</div>`)
                    .addTo(this.map);
            };
            this.map.on('click', LAYER, this.clickFn);
        }
        this.built = true;
    }

    private async refresh() {
        try {
            const res = await fetch(rabbitUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const src = this.map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
            if (src) src.setData(this.register(fc));
        } catch {
            // keep last frame
        }
    }

    async setVisible(visible: boolean) {
        if (visible) {
            if (!this.built) await this.build();
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'visible');
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'none');
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    }

    remove() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.clickFn) { this.map.off('click', LAYER, this.clickFn); this.clickFn = null; }
        if (this.map.getLayer(LAYER)) this.map.removeLayer(LAYER);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
        this.built = false;
    }
}
```

- [ ] **Step 2: Wire it default-on in LayerControl**

Add to the `<script>` imports:

```ts
import { RabbitLayer } from '$lib/components/map/rabbit-layer';
```

Add a handle beside `ghostLayer`:

```ts
let rabbitLayer: RabbitLayer | undefined;
```

In the `map.onLoad((_map) => { ... })` block, after the ghost wiring, add:

```ts
        if (rabbitLayer) rabbitLayer.remove();
        rabbitLayer = new RabbitLayer(_map);
        // Rabbit Layer is default-ON: only opted-in (verified && showOnMap) users appear.
        void rabbitLayer.setVisible(true);
```

- [ ] **Step 3: Build + manual verification**

```bash
cd apps/run.gpx && ./build-frontend.sh
# webapp needs the feed + internal secret + run.human reachable:
cd apps/run.gpx/webapp && \
  GHOST_FEED_URL=http://localhost:3005/nodes.json \
  RUN_HUMAN_INTERNAL_URL=http://localhost:3001 \
  AUTH_INTERNAL_SECRET=<same as run.human> \
  PORT=3002 npm run dev
```
Seed `/tmp/nodes.json` with a node whose numeric id matches your verified radio (`node -e 'console.log(parseInt("4359d0cc",16)>>>0)'` → put that as the key, with real Vegas lat/lon), keep run.human (Task 9) running with `showOnMap` ON.

1. Open `/use1/studio/app` → your rabbit pin (your chosen pinIcon/pinColor) shows at the seeded position by default.
2. Click it → popup shows your `displayName`.
3. In whoami, toggle **Show me on the map** OFF → within ~30-45s (or reload) the pin disappears.
4. Devtools Network: `/use1/api/gpx/public/rabbits` returns only opted-in entries; no `privateKey`/`mqttPassword` anywhere.

Expected: all four hold.

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
git commit -m "feat(gpx-studio): RabbitLayer (opt-in live attendees, default-on)"
```

---

## Post-implementation notes (not tasks)

- **Deploy config:** set `GHOST_FEED_URL` (meshtk internal nodes.json), and add `AUTH_INTERNAL_SECRET` to run.gpx's task definition (it currently only calls run.human's *public* checkins feed). Making the meshtk `nodes.json` address private is separate infra work (spec §"Evolution").
- **Optional follow-ups (deferred):** a layer-control checkbox to toggle the Rabbit Layer off; `showOnMap` auto-expiry; a subtle ghost-mode map theme; a real ghost SVG art pass.
