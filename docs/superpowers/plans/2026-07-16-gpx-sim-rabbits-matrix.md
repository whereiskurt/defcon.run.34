# Sim-rabbit camouflage crowd + matrix ghost overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the gpx.defcon.run rabbit layer with ~10–12 simulated meshtk "runners" (cover traffic that gives real attendees k-anonymity), rendered as a tinted rabbit silhouette with a radio-config popup, plus a matrix-green digital-rain overlay when the ghost layer activates.

**Architecture:** A new meshtk sim-rabbit fleet publishes real telemetry into the same `nodes.json` the ghosts use. The run.gpx trust-boundary proxy resolves those nodes against a static local identity map and unions them with real opted-in rabbits — real and sim emit the *same* field set so they're indistinguishable. The gpx-studio rabbit layer swaps its branded pin for one rabbit silhouette tinted per-color and shows a rich popup; the ghost layer additionally mounts a ported matrix-rain canvas.

**Tech Stack:** Next.js 16 (run.gpx webapp, App Router route handlers), Vitest 4, TypeScript, Svelte/Vite (gpx-studio), Mapbox GL JS, meshtk (Go, YAML fleet config), Docker/ECS.

## Global Constraints

- **Node ≥ 22.12 for vitest** — run `nvm use 23.6.0` before `npx vitest` in `apps/run.gpx/webapp` (default v22.1 fails, looks like a test failure but is environmental).
- **Trust boundary:** the run.gpx proxies NEVER emit `pubkey`/`privkey`/mqtt creds/`hash`. Every emitted feature uses a field-by-field allowlist. Never spread a raw node/user object.
- **XSS:** every user/text value interpolated into a Mapbox `setHTML` popup MUST be `escapeHtml`'d (`./escape-html`). Mapbox `text-field` canvas labels are not an HTML sink; click popups are.
- **pinColor coercion:** resolve color with `pinColor || DEFAULT_PIN_COLOR` (`||`, NOT `??`) — an empty-string pinColor must fall through to the default or pins render black.
- **Regex isolation:** ghost filter is `/ghost|contest|operative/i`; sim filter is `/rabbit-sim/i`. Sim node longNames (`rabbit-sim-<slug>-NN`) must never match the ghost regex, and vice-versa.
- **meshtk source lives upstream** (`~/working/meshtk`) per repo convention — embedded GPX/Go changes go there; only the repo-tracked `apps/run.mqtt/meshtk/{meshtk.dc34.yaml, nodes.*.json, Dockerfile.meshtk}` are edited here. No new GPX tracks (reuse embedded Vegas basenames).
- **Shared radio field set** emitted for every rabbit feature (real + sim): `displayName, userType, pinColor, hwModel, role, region, modemPreset, fwVersion, channel, battery, lastSeen`. Missing string fields → `""`; missing battery → `-1`.

---

## File Structure

**Feature A — sim rabbits (trust boundary + fleet + presentation)**
- Create `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts` — slug→identity map + parse helpers
- Modify `apps/run.gpx/webapp/src/lib/mesh-nodes.ts` — `radioFields()` helper, `simRabbitFeatureCollection()`, extend `rabbitFeatureCollection()`
- Modify `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.ts` — union real+sim, degrade-when-mesh-map-fails
- Modify `apps/run.mqtt/meshtk/meshtk.dc34.yaml` — add sim fleet members
- Create `apps/run.mqtt/meshtk/nodes.rabbit.<slug>.json` — seeds
- Modify `apps/run.mqtt/meshtk/Dockerfile.meshtk` — `COPY nodes.rabbit.*.json /app/`
- Create `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-svg.ts` — `rabbitSvg(color)`
- Modify `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts` — silhouette + rich popup
- Modify `apps/run.gpx/gpx-studio/website/src/app.css` — `.dc34-rabbit-popup` dark card

**Feature B — matrix ghost overlay**
- Create `apps/run.gpx/gpx-studio/website/src/lib/components/map/matrix-rain.ts` — canvas overlay class
- Modify `apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts` — start/stop matrix on setVisible
- Modify `apps/run.gpx/gpx-studio/website/src/app.css` — `.dc34-matrix-canvas` / `.dc34-matrix-tint`

**Tests**
- Modify `apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts`
- Modify `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.test.ts`

---

### Task 1: Sim-rabbit identity map + parse helpers

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts`
- Test: `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.test.ts`

**Interfaces:**
- Produces: `SIM_RABBITS: Record<string, SimRabbit>` where `SimRabbit = { displayName: string; pinColor: string }`; `simRabbit(slug: string): SimRabbit | undefined`; `simRabbitSlug(longName: string): string | null`; `isSimRabbit(longName: string, shortName?: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.gpx/webapp/src/lib/sim-rabbit-identities.test.ts
import { describe, it, expect } from "vitest";
import { SIM_RABBITS, simRabbit, simRabbitSlug, isSimRabbit } from "./sim-rabbit-identities";

describe("sim-rabbit-identities", () => {
  it("has 10-12 rabbits, all rabbit_#### names, no fixed/duplicate colors", () => {
    const slugs = Object.keys(SIM_RABBITS);
    expect(slugs.length).toBeGreaterThanOrEqual(10);
    expect(slugs.length).toBeLessThanOrEqual(12);
    for (const s of slugs) {
      expect(SIM_RABBITS[s].displayName).toMatch(/^rabbit_[0-9a-f]{4}$/);
      expect(SIM_RABBITS[s].pinColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // displayNames unique (camouflage: no obvious repeats)
    const names = slugs.map((s) => SIM_RABBITS[s].displayName);
    expect(new Set(names).size).toBe(names.length);
  });
  it("parses slug from longName", () => {
    expect(simRabbitSlug("rabbit-sim-swift-00")).toBe("swift");
    expect(simRabbitSlug("rabbit-sim-dash-07")).toBe("dash");
    expect(simRabbitSlug("elkentaro-09")).toBeNull();
    expect(simRabbitSlug("ghost-condor-00")).toBeNull();
  });
  it("detects sim rabbits by name, isolated from ghosts", () => {
    expect(isSimRabbit("rabbit-sim-swift-00", "R00")).toBe(true);
    expect(isSimRabbit("ghost-condor-00", "GC00")).toBe(false);
    expect(isSimRabbit("elkentaro-09", "J09")).toBe(false);
  });
  it("resolves identity, undefined for unknown slug", () => {
    const first = Object.keys(SIM_RABBITS)[0];
    expect(simRabbit(first)).toEqual(SIM_RABBITS[first]);
    expect(simRabbit("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && nvm use 23.6.0 && npx vitest run src/lib/sim-rabbit-identities.test.ts`
Expected: FAIL — "Cannot find module './sim-rabbit-identities'".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts
/**
 * Simulated-rabbit identities — camouflage cover traffic for the rabbit layer.
 * Each sim rabbit is a meshtk node named `rabbit-sim-<slug>-NN`; this map turns
 * the slug into a display identity (rabbit_#### to mimic real run.human names)
 * and a distinct pin tint. Mirrors ghost-identities.ts — no run.human account.
 */
export type SimRabbit = { displayName: string; pinColor: string };

export const SIM_RABBITS: Record<string, SimRabbit> = {
  swift:  { displayName: "rabbit_4a1c", pinColor: "#e6007a" },
  dash:   { displayName: "rabbit_1337", pinColor: "#00d4aa" },
  comet:  { displayName: "rabbit_9f2a", pinColor: "#7b61ff" },
  nova:   { displayName: "rabbit_0b73", pinColor: "#ff6b35" },
  echo:   { displayName: "rabbit_c4e8", pinColor: "#00b4d8" },
  vega:   { displayName: "rabbit_2d5f", pinColor: "#f15bb5" },
  orbit:  { displayName: "rabbit_8ab0", pinColor: "#ffd166" },
  pixel:  { displayName: "rabbit_63d1", pinColor: "#06d6a0" },
  raven:  { displayName: "rabbit_f07e", pinColor: "#ef476f" },
  scout:  { displayName: "rabbit_5c92", pinColor: "#4cc9f0" },
  ember:  { displayName: "rabbit_a318", pinColor: "#fb5607" },
  frost:  { displayName: "rabbit_7e44", pinColor: "#8ecae6" },
};

const SIM_RE = /rabbit-sim/i;

export function isSimRabbit(longName: string | undefined, shortName?: string): boolean {
  return SIM_RE.test(longName ?? "") || SIM_RE.test(shortName ?? "");
}

/** "rabbit-sim-swift-00" → "swift"; non-sim names → null. */
export function simRabbitSlug(longName: string): string | null {
  const m = longName.toLowerCase().match(/rabbit-sim[-_]([a-z0-9]+)/);
  return m?.[1] ?? null;
}

export function simRabbit(slug: string): SimRabbit | undefined {
  return SIM_RABBITS[slug];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/sim-rabbit-identities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts apps/run.gpx/webapp/src/lib/sim-rabbit-identities.test.ts
git commit -m "feat(gpx): sim-rabbit identity map + name parsing (camouflage crowd)"
```

---

### Task 2: `radioFields()` helper, `simRabbitFeatureCollection()`, extend `rabbitFeatureCollection()`

**Files:**
- Modify: `apps/run.gpx/webapp/src/lib/mesh-nodes.ts`
- Test: `apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts`

**Interfaces:**
- Consumes: `SIM_RABBITS`/`simRabbitSlug`/`isSimRabbit` (Task 1); existing `hasValidPosition`, `coord`, `lastSeen`, `keyToNum`, `MeshNode`, `NodeDb`, `MeshMapEntry`.
- Produces: `radioFields(n: MeshNode): { hwModel, role, region, modemPreset, fwVersion, channel, battery }` (all strings except `battery: number`); `simRabbitFeatureCollection(db: NodeDb): GeoJSON.FeatureCollection`. `rabbitFeatureCollection` now also emits the radio + `pinColor` fields (drops `pinIcon`).

- [ ] **Step 1: Write the failing test** (append to `mesh-nodes.test.ts`)

```ts
// add to imports at top of mesh-nodes.test.ts:
//   simRabbitFeatureCollection, radioFields,
// and add these node fixtures + a describe block:

const simNode = {
  from: 111, fromStr: "!0000006f", longName: "rabbit-sim-swift-00", shortName: "R00",
  latitude: 360817149, longitude: -1151727650, lastMapReport: 1754357652,
  hwModel: "TRACKER_T1000_E", role: "CLIENT_MUTE", region: "US", modemPreset: "MEDIUM_FAST",
  fwVersion: "2.7.2", hasDefaultCh: true, batteryLevel: 71,
  privkey: "0xSECRET", pubkey: "0xSECRET",
};
const realRadio = {
  from: 2503245760, fromStr: "!95347fc0", longName: "elkentaro-09", shortName: "J09",
  latitude: 356303231, longitude: 1397374428, lastMapReport: 1754357805,
  hwModel: "HELTEC_V3", role: "CLIENT", region: "US", modemPreset: "LONG_FAST",
  fwVersion: "2.6.0", hasDefaultCh: false, batteryLevel: 42,
};

describe("radioFields", () => {
  it("extracts the allowlisted radio config, no keys", () => {
    const r = radioFields(simNode as any);
    expect(r).toEqual({
      hwModel: "TRACKER_T1000_E", role: "CLIENT_MUTE", region: "US",
      modemPreset: "MEDIUM_FAST", fwVersion: "2.7.2", channel: "dc.run", battery: 71,
    });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
  it("defaults missing fields", () => {
    expect(radioFields({ longName: "x" } as any)).toEqual({
      hwModel: "", role: "", region: "", modemPreset: "", fwVersion: "", channel: "custom", battery: -1,
    });
  });
});

describe("simRabbitFeatureCollection", () => {
  it("emits known sim rabbits as rabbit features with radio fields, keys stripped", () => {
    const fc = simRabbitFeatureCollection({ "111": simNode } as any);
    expect(fc.features).toHaveLength(1);
    const p = fc.features[0].properties as any;
    expect(p.displayName).toBe("rabbit_4a1c"); // SIM_RABBITS.swift
    expect(p.pinColor).toBe("#e6007a");
    expect(p.userType).toBe("rabbit");
    expect(p.hwModel).toBe("TRACKER_T1000_E");
    expect(p.battery).toBe(71);
    expect(JSON.stringify(fc)).not.toContain("SECRET");
  });
  it("skips ghosts, real nodes, unknown slugs, and no-position sims", () => {
    const db = {
      "1": { longName: "ghost-condor-00", latitude: 1, longitude: 1 },
      "2": { longName: "elkentaro-09", latitude: 356303231, longitude: 1397374428 },
      "3": { longName: "rabbit-sim-unknownslug-00", latitude: 360817149, longitude: -1151727650 },
      "4": { longName: "rabbit-sim-swift-01", latitude: 0, longitude: 0 },
    };
    expect(simRabbitFeatureCollection(db as any).features).toHaveLength(0);
  });
});

describe("rabbitFeatureCollection radio parity", () => {
  it("real rabbits emit the same radio field set as sims", () => {
    const fc = rabbitFeatureCollection(
      { "2503245760": realRadio } as any,
      [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinColor: "#00d4aa" }]
    );
    const p = fc.features[0].properties as any;
    expect(p.hwModel).toBe("HELTEC_V3");
    expect(p.channel).toBe("custom"); // hasDefaultCh false
    expect(p.battery).toBe(42);
    expect(p.pinColor).toBe("#00d4aa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/mesh-nodes.test.ts`
Expected: FAIL — `radioFields`/`simRabbitFeatureCollection` not exported.

- [ ] **Step 3: Write minimal implementation** (edit `mesh-nodes.ts`)

Add the radio-typed fields to `MeshNode` (after `batteryLevel?: number;`):
```ts
  hwModel?: string;
  role?: string;
  region?: string;
  modemPreset?: string;
  fwVersion?: string;
  hasDefaultCh?: boolean;
```

Add the import at top:
```ts
import { simRabbitSlug, simRabbit, isSimRabbit } from "./sim-rabbit-identities";
```

Add the helper (after `coord`):
```ts
/** Allowlisted radio-config subset shown in rabbit popups. Never keys/creds. */
export function radioFields(n: MeshNode) {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    hwModel: s(n.hwModel),
    role: s(n.role),
    region: s(n.region),
    modemPreset: s(n.modemPreset),
    fwVersion: s(n.fwVersion),
    channel: n.hasDefaultCh === true ? "dc.run" : "custom",
    battery: typeof n.batteryLevel === "number" ? n.batteryLevel : -1,
  };
}
```

Add the sim collection (after `ghostFeatureCollection`):
```ts
export function simRabbitFeatureCollection(db: NodeDb): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, n] of Object.entries(db)) {
    if (!isSimRabbit(n.longName, n.shortName) || !hasValidPosition(n)) continue;
    const slug = simRabbitSlug(n.longName as string);
    const id = slug ? simRabbit(slug) : undefined;
    if (!id) continue; // unknown slug → not part of the crowd
    features.push({
      type: "Feature",
      id: keyToNum(key, n),
      geometry: { type: "Point", coordinates: coord(n) },
      properties: {
        displayName: id.displayName,
        userType: "rabbit",
        pinColor: id.pinColor,
        ...radioFields(n),
        lastSeen: lastSeen(n),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
```

Replace the `properties` block inside `rabbitFeatureCollection` with:
```ts
      properties: {
        displayName: id.displayName || "a rabbit",
        userType: id.userType ?? "rabbit",
        pinColor: id.pinColor ?? "",
        ...radioFields(n),
        lastSeen: lastSeen(n),
      },
```
(Drop the `pinIcon` property — the layer now forces the rabbit silhouette.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/mesh-nodes.test.ts`
Expected: PASS (existing + new tests). If an existing test asserted `pinIcon` on a rabbit feature, update it to drop `pinIcon`.

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/webapp/src/lib/mesh-nodes.ts apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts
git commit -m "feat(gpx): sim-rabbit feature collection + radio-config fields on rabbit features"
```

---

### Task 3: Union real + sim in the rabbit proxy, degrade when mesh-map fails

**Files:**
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.test.ts`

**Interfaces:**
- Consumes: `rabbitFeatureCollection`, `simRabbitFeatureCollection` (Task 2).

- [ ] **Step 1: Write the failing test** (replace the "fails soft when the internal feed errors" test and add two)

```ts
// import simRabbitFeatureCollection is not needed in the test; assert via output.
// Replace the second test and add sim cases. Full describe block:

const sim = {
  longName: "rabbit-sim-swift-00", shortName: "R00",
  latitude: 360817149, longitude: -1151727650, hwModel: "TRACKER_T1000_E", batteryLevel: 71,
};

it("includes sim rabbits alongside real ones", async () => {
  stubFetch(
    { "2503245760": real, "111": sim },
    { entries: [{ nodeNum: 2503245760, displayName: "rabbit_9f2a", pinColor: "#00d4aa" }] }
  );
  const { GET } = await import("./route");
  const names = (await (await GET()).json()).features.map((f: any) => f.properties.displayName);
  expect(names).toContain("rabbit_9f2a");    // real
  expect(names).toContain("rabbit_4a1c");    // sim swift
});

it("still returns sim rabbits when the internal mesh-map feed errors", async () => {
  stubFetch({ "111": sim }, { entries: [] }, false); // mapOk=false
  const { GET } = await import("./route");
  const body = await (await GET()).json();
  expect(body.features.map((f: any) => f.properties.displayName)).toEqual(["rabbit_4a1c"]);
});

it("fails soft to empty when the nodes feed itself errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("mesh-map")
      ? { ok: true, json: async () => ({ entries: [] }) }
      : { ok: false, json: async () => ({}) }
  ));
  const { GET } = await import("./route");
  expect(await (await GET()).json()).toEqual({ type: "FeatureCollection", features: [] });
});
```

Note: each `await import("./route")` re-imports; vitest module cache means the route's top-level `GET` re-runs fetch each call — matches the existing test style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/rabbits/route.test.ts`
Expected: FAIL — sim rabbits absent / empty on mesh-map error.

- [ ] **Step 3: Write minimal implementation** (edit `route.ts` `GET`)

```ts
import { rabbitFeatureCollection, simRabbitFeatureCollection, type NodeDb, type MeshMapEntry } from "@/lib/mesh-nodes";

export async function GET() {
  try {
    const [nodesRes, mapRes] = await Promise.allSettled([
      fetch(GHOST_FEED_URL, { cache: "no-store", signal: AbortSignal.timeout(3000) }),
      fetch(`${RUN_HUMAN_URL}/api/internal/mesh-map`, {
        cache: "no-store",
        headers: { "x-internal-secret": INTERNAL_SECRET },
        signal: AbortSignal.timeout(3000),
      }),
    ]);
    // Nodes feed is the hard dependency — no nodes, nothing to draw.
    if (nodesRes.status !== "fulfilled" || !nodesRes.value.ok) return json(EMPTY);
    const db = (await nodesRes.value.json()) as NodeDb;

    // Sim rabbits need only the nodes feed (name-filtered) — always included.
    const sim = simRabbitFeatureCollection(db);

    // Real rabbits need the internal opt-in feed; degrade to none if it failed.
    let realFeatures: GeoJSON.Feature[] = [];
    if (mapRes.status === "fulfilled" && mapRes.value.ok) {
      const { entries } = (await mapRes.value.json()) as { entries: MeshMapEntry[] };
      realFeatures = rabbitFeatureCollection(db, entries ?? []).features;
    }
    return json({ type: "FeatureCollection", features: [...realFeatures, ...sim.features] });
  } catch (error) {
    console.error("rabbit proxy error:", error);
    return json(EMPTY);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/app/api/gpx/public/rabbits/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full webapp suite + typecheck**

Run: `cd apps/run.gpx/webapp && npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.ts apps/run.gpx/webapp/src/app/api/gpx/public/rabbits/route.test.ts
git commit -m "feat(gpx): union sim rabbits into the rabbit proxy; sims survive mesh-map outage"
```

---

### Task 4: meshtk sim-rabbit fleet + seeds + Dockerfile copy

**Files:**
- Modify: `apps/run.mqtt/meshtk/meshtk.dc34.yaml` (append Fleet members)
- Create: `apps/run.mqtt/meshtk/nodes.rabbit.swift.json` … (one per slug in SIM_RABBITS — 12)
- Modify: `apps/run.mqtt/meshtk/Dockerfile.meshtk` (add COPY)

**Interfaces:**
- Consumes: the 12 slugs from `SIM_RABBITS` (Task 1) — names must match exactly. Reuses embedded GPX basenames present in `~/working/meshtk/internal/embedded/gpx/ghosts/` and `/city/`.

No unit test (YAML/config/asset). Verified by a local meshtk config load + the Task 10 docker-compose run.

- [ ] **Step 1: Add the fleet members.** Append 12 members to the `Fleet:` list in `meshtk.dc34.yaml`, one per slug, distributing across embedded GPX tracks so they don't all overlap. Template (repeat per slug, unique `Seed` UUID, cycling `GPXFile` through `./goldstein.gpx ./turing.gpx ./hopper.gpx ./ladyada.gpx ./sharp.gpx ./mudge.gpx ./gibson.gpx ./condor.gpx ./city/manhatten.gpx ./city/japan.gpx`):

```yaml
  - Id: "rabbit.swift"
    Description: "rabbit.swift"
    BehaviourTag: ["nodeinfo", "movement", "gitter"]
    BehaviourSecs: 30
    RampSteadySecs: 2419200
    Seed: "b0000001-6969-6969-b383-4dfff4fb3801"
    ShortNameTmpl: "R{{.nodeId}}"
    LongNameTmpl: "rabbit-sim-swift-{{.nodeId}}"
    NodesPerRampInterval: [1]
    RampUpSecs: 2
    RampDownSecs: 2
    NodesPerSteadyInterval: [1]
    Distribution: "uniform"
    BroadcastGitterSec: 600
    LatLongAltGitter: 1000
    TextMessageGitterSec: 300
    NodeDbPath: "./nodes.rabbit.swift.json"
    Movement:
      - Type: "gpx"
        GPXFile: "./goldstein.gpx"
        Travel: "loop"
```

Slugs (must equal `SIM_RABBITS` keys): swift, dash, comet, nova, echo, vega, orbit, pixel, raven, scout, ember, frost. `ShortNameTmpl` "R{{.nodeId}}" for all.

- [ ] **Step 2: Create the 12 seed files.** Each `nodes.rabbit.<slug>.json` mirrors the ghost seed shape but with a unique node number, a rabbit longName, and plausible radio config. Vary `hwModel`/`role`/`modemPreset`/`fwVersion`/`batteryLevel` and start position (Vegas area, non-zero) across the set so the crowd looks heterogeneous. Example (`nodes.rabbit.swift.json`):

```json
{
  "3010000001": {
    "from": 3010000001,
    "fromStr": "!b3670001",
    "longName": "rabbit-sim-swift-00",
    "shortName": "R00",
    "hwModel": "TRACKER_T1000_E",
    "role": "CLIENT",
    "pubkey": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "privkey": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "fwVersion": "2.7.2",
    "region": "US",
    "modemPreset": "MEDIUM_FAST",
    "hasDefaultCh": true,
    "lastMapReport": 1754357652,
    "latitude": 360817149,
    "longitude": -1151727650,
    "altitude": 640,
    "precision": 32,
    "batteryLevel": 88,
    "voltage": 4.02,
    "chUtil": 12.4,
    "airUtilTx": 1.1,
    "uptime": 120000,
    "seenBy": { "msh/US/2/e/dc.run": 1754357652 }
  }
}
```

Node numbers: use the `3010000001`..`3010000012` range (fromStr = `!` + hex of the number). The sim `nodeNum` must not collide with any ghost seed number.

- [ ] **Step 3: Add the Dockerfile COPY.** In `apps/run.mqtt/meshtk/Dockerfile.meshtk`, directly after the `COPY nodes.ghost.*.json /app/` line:

```dockerfile
# Sim-rabbit fleet node seeds (camouflage cover traffic; keys are test data,
# stripped at the run.gpx trust boundary).
COPY nodes.rabbit.*.json /app/
```

- [ ] **Step 4: Verify the config loads locally.** From a checkout of `~/working/meshtk` (or the build context after `apps/run.mqtt/build.sh` cp), confirm the YAML parses and the fleet lists 12 rabbit members:

Run: `cd apps/run.mqtt/meshtk && grep -c 'LongNameTmpl: "rabbit-sim-' meshtk.dc34.yaml`
Expected: `12`.
Run: `ls nodes.rabbit.*.json | wc -l`
Expected: `12`.

- [ ] **Step 5: Commit**

```bash
git add apps/run.mqtt/meshtk/meshtk.dc34.yaml apps/run.mqtt/meshtk/nodes.rabbit.*.json apps/run.mqtt/meshtk/Dockerfile.meshtk
git commit -m "feat(mesh): sim-rabbit fleet (12 nodes) + seeds for camouflage cover traffic"
```

---

### Task 5: `rabbitSvg(color)` silhouette

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-svg.ts`

No vitest (studio has no runner). Verified by svelte-check in Task 6.

- [ ] **Step 1: Write the module**

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-svg.ts
/**
 * One rabbit silhouette for the whole rabbit layer, tinted by the runner's
 * pinColor. Same shape for real + sim rabbits = camouflage; color = identity.
 * viewBox 0 0 24 24, bottom-anchored (feet at y≈23) like the branded map-pin.
 */
export function rabbitSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <ellipse cx="9.4" cy="6.5" rx="1.5" ry="4" fill="${color}" stroke="#101015" stroke-width="0.6"/>
    <ellipse cx="14.6" cy="6.5" rx="1.5" ry="4" fill="${color}" stroke="#101015" stroke-width="0.6"/>
    <path d="M6.5 15c0-3 2.5-5 5.5-5s5.5 2 5.5 5c0 3-2.2 5.5-5.5 7.5C8.7 20.5 6.5 18 6.5 15z"
          fill="${color}" stroke="#101015" stroke-width="0.7"/>
    <circle cx="10.3" cy="14" r="0.9" fill="#101015"/>
    <circle cx="13.7" cy="14" r="0.9" fill="#101015"/>
  </svg>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-svg.ts
git commit -m "feat(gpx-studio): rabbit silhouette svg (tinted per-color)"
```

---

### Task 6: Rabbit layer — tinted silhouette + rich popup

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts`

**Interfaces:**
- Consumes: `rabbitSvg` (Task 5); feature `properties` from Task 2 (`displayName, pinColor, hwModel, role, region, modemPreset, fwVersion, channel, battery`).

- [ ] **Step 1: Swap icon source + registration.** Replace the `dc34-pins` import with `rabbitSvg`, and rewrite `register()` to key images by color only:

```ts
import mapboxgl from 'mapbox-gl';
import { rabbitSvg } from './rabbit-svg';
import { escapeHtml } from './escape-html';

const DEFAULT_PIN_COLOR = '#e6007a';
// ... SOURCE/LAYER/POLL_MS unchanged ...

private register(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    for (const f of fc.features) {
        const p = (f.properties ?? {}) as { pinColor?: string };
        const color = p.pinColor || DEFAULT_PIN_COLOR; // || not ?? (empty-string coercion)
        const iconId = `rabbit-${color}`;
        this.loadSvgImage(iconId, rabbitSvg(color));
        (f.properties as Record<string, unknown>).iconId = iconId;
    }
    return fc;
}
```
(`loadSvgImage` stays as-is.)

- [ ] **Step 2: Rich popup.** Replace the `clickFn` body with a radio-config card (all values escaped, missing → `—`):

```ts
this.clickFn = (e) => {
    const f = (e as unknown as { features?: GeoJSON.Feature[] }).features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const esc = (v: unknown) => escapeHtml(v == null || v === '' ? '—' : String(v));
    const color = (p.pinColor as string) || DEFAULT_PIN_COLOR;
    const batt = typeof p.battery === 'number' && p.battery >= 0 ? `${p.battery}%` : '—';
    const rows: [string, string][] = [
        ['Model', esc(p.hwModel)],
        ['Role', esc(p.role)],
        ['Region', `${esc(p.region)} · ${esc(p.modemPreset)}`],
        ['Firmware', esc(p.fwVersion)],
        ['Channel', esc(p.channel)],
        ['Battery', batt],
    ];
    const grid = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    this.popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(
            `<div class="dc34-rabbit-reveal">` +
            `<div class="dc34-rabbit-head"><span class="dc34-rabbit-dot" style="background:${escapeHtml(color)}"></span>` +
            `<strong>${esc(p.displayName)}</strong></div>` +
            `<dl class="dc34-rabbit-grid">${grid}</dl></div>`
        )
        .addTo(this.map);
};
```
(`color` is interpolated into a `style` attr — it comes from our own SIM_RABBITS / run.human pinColor, but escape it anyway per the invariant.)

- [ ] **Step 3: Typecheck the studio**

Run: `cd apps/run.gpx/gpx-studio/website && nvm use 23.6.0 && npx svelte-check --threshold error`
Expected: 0 errors (warnings ok).

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts
git commit -m "feat(gpx-studio): rabbit layer uses tinted silhouette + radio-config popup"
```

---

### Task 7: Rabbit popup dark-card CSS

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/app.css` (append)

**Interfaces:**
- Consumes: popup class names from Task 6 (`dc34-rabbit-popup` container, `.dc34-rabbit-reveal`, `.dc34-rabbit-head`, `.dc34-rabbit-dot`, `.dc34-rabbit-grid`).

- [ ] **Step 1: Append the rules** (mirror the `.dc34-route-popup` specificity trick so the dark backing wins):

```css
/* Rabbit layer popup — dark radio-config card (real + sim rabbits, identical). */
.dc34-rabbit-popup.mapboxgl-popup .mapboxgl-popup-content {
    background: #14141c;
    color: #e4e4ef;
    border: 1px solid #2a2a3a;
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
}
.dc34-rabbit-popup.mapboxgl-popup .mapboxgl-popup-close-button { color: #e4e4ef; font-size: 16px; padding: 2px 6px; }
.dc34-rabbit-popup.mapboxgl-popup-anchor-top .mapboxgl-popup-tip { border-bottom-color: #14141c; }
.dc34-rabbit-popup.mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip { border-top-color: #14141c; }
.dc34-rabbit-popup.mapboxgl-popup-anchor-left .mapboxgl-popup-tip { border-right-color: #14141c; }
.dc34-rabbit-popup.mapboxgl-popup-anchor-right .mapboxgl-popup-tip { border-left-color: #14141c; }
.dc34-rabbit-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 13px; }
.dc34-rabbit-dot { width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 6px currentColor; }
.dc34-rabbit-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; font-size: 11px; }
.dc34-rabbit-grid dt { color: #8a8aa0; }
.dc34-rabbit-grid dd { margin: 0; color: #e4e4ef; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Typecheck (CSS is imported globally; confirm build still parses)**

Run: `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/app.css
git commit -m "style(gpx-studio): dark radio-config card for the rabbit popup"
```

---

### Task 8: Matrix-rain overlay class

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/matrix-rain.ts`

- [ ] **Step 1: Write the class** (port from `apps/static/landing`, recolored matrix-green, reduced-motion → static tint only):

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/matrix-rain.ts
/**
 * Matrix digital-rain + green tint overlay for ghost mode. Ported from
 * apps/static/landing/index.html, recolored to matrix-green. Mounts a fixed
 * full-viewport canvas over the map (pointer-events:none) plus a tint layer.
 * User-triggered easter egg → if reduced-motion, show the static tint but no
 * animated rain (lesson from cash-rain: a hard reduced-motion gate made a
 * user-triggered effect invisible in prod).
 */
const GREEN = '#00ff41';
const GLYPHS = '01</>{}[]#$ラ ンドセキュ▚▞◆·'.split('');

export class MatrixRain {
    private canvas: HTMLCanvasElement | null = null;
    private tint: HTMLDivElement | null = null;
    private raf = 0;
    private running = false;
    private drops: number[] = [];
    private cols = 0; private w = 0; private h = 0; private dpr = 1;
    private last = 0;
    private readonly fontSize = 15;
    private readonly reduce = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    constructor(private parent: HTMLElement) {}

    private resize = () => {
        if (!this.canvas) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.w = this.canvas.width = Math.floor(innerWidth * this.dpr);
        this.h = this.canvas.height = Math.floor(innerHeight * this.dpr);
        this.canvas.style.width = innerWidth + 'px';
        this.canvas.style.height = innerHeight + 'px';
        this.cols = Math.floor(innerWidth / this.fontSize);
        this.drops = new Array(this.cols).fill(0).map(() => Math.random() * -50);
    };

    private draw = (ts: number) => {
        const c = this.canvas; if (!c) return;
        const ctx = c.getContext('2d'); if (!ctx) return;
        if (ts - this.last > 55) {
            this.last = ts;
            ctx.fillStyle = 'rgba(0, 8, 2, 0.28)';
            ctx.fillRect(0, 0, this.w, this.h);
            ctx.font = (this.fontSize * this.dpr) + "px 'JetBrains Mono', monospace";
            for (let i = 0; i < this.cols; i++) {
                const txt = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
                const x = i * this.fontSize * this.dpr;
                const y = this.drops[i] * this.fontSize * this.dpr;
                ctx.fillStyle = Math.random() > 0.975 ? '#ffffff' : GREEN;
                ctx.fillText(txt, x, y);
                if (y > this.h && Math.random() > 0.975) this.drops[i] = Math.random() * -20;
                this.drops[i]++;
            }
        }
        this.raf = requestAnimationFrame(this.draw);
    };

    start() {
        if (this.running) return;
        this.running = true;
        this.tint = document.createElement('div');
        this.tint.className = 'dc34-matrix-tint';
        this.parent.appendChild(this.tint);
        requestAnimationFrame(() => this.tint?.classList.add('on'));
        if (this.reduce) return; // static tint only
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'dc34-matrix-canvas';
        this.parent.appendChild(this.canvas);
        this.resize();
        addEventListener('resize', this.resize);
        requestAnimationFrame(() => this.canvas?.classList.add('on'));
        this.raf = requestAnimationFrame(this.draw);
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        cancelAnimationFrame(this.raf); this.raf = 0;
        removeEventListener('resize', this.resize);
        this.canvas?.remove(); this.canvas = null;
        this.tint?.remove(); this.tint = null;
    }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/matrix-rain.ts
git commit -m "feat(gpx-studio): matrix-rain overlay class (ghost mode)"
```

---

### Task 9: Bind matrix to ghost activation + matrix CSS

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/app.css` (append)

**Interfaces:**
- Consumes: `MatrixRain` (Task 8).

- [ ] **Step 1: Wire the matrix into GhostLayer.** Add the import, a field, and start/stop in `setVisible`/`remove`:

```ts
import { MatrixRain } from './matrix-rain';
// ...
export class GhostLayer {
    // ...existing fields...
    private matrix = new MatrixRain(this.map.getContainer());
```
In `setVisible(true)` after making the layer visible: `this.matrix.start();`
In `setVisible(false)` after hiding: `this.matrix.stop();`
In `remove()` before removing the layer: `this.matrix.stop();`

(Note: `this.map` is set in the constructor, so initialize `matrix` in the constructor body instead if the field initializer runs before `map` is assigned — assign `this.matrix = new MatrixRain(map.getContainer());` inside the constructor.)

- [ ] **Step 2: Append matrix CSS to `app.css`**

```css
/* Ghost-mode matrix overlay — fixed over the map, under controls, non-interactive. */
.dc34-matrix-canvas {
    position: fixed; inset: 0; z-index: 5; pointer-events: none;
    opacity: 0; transition: opacity 500ms ease;
}
.dc34-matrix-canvas.on { opacity: 0.55; }
.dc34-matrix-tint {
    position: fixed; inset: 0; z-index: 4; pointer-events: none;
    background: radial-gradient(ellipse at center, rgba(0,40,10,0.10), rgba(0,20,6,0.42));
    mix-blend-mode: screen; opacity: 0; transition: opacity 600ms ease;
}
.dc34-matrix-tint.on { opacity: 1; }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts apps/run.gpx/gpx-studio/website/src/app.css
git commit -m "feat(gpx-studio): matrix rain + green tint on ghost-layer activation"
```

---

### Task 10: Integration build + local end-to-end verify

**Files:** none (verification only).

- [ ] **Step 1: Build the studio into the webapp**

Run: `cd apps/run.gpx && ./build-frontend.sh`
Expected: gpx-studio builds, artifact lands in `webapp/public/studio/`.

- [ ] **Step 2: Full webapp test + typecheck**

Run: `cd apps/run.gpx/webapp && nvm use 23.6.0 && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 3: Local mesh end-to-end (optional but recommended).** Bring up `apps/run.mqtt/docker-compose.yaml`, wait ~5 min for ramp, and confirm sim rabbits publish and reach the proxy:

Run: `curl -s localhost:3005/nodes.json | grep -c rabbit-sim` (expect ≥1 once ramped)
Run (against a local run.gpx or the deployed proxy): `curl -s '.../api/gpx/public/rabbits' | jq '[.features[].properties.displayName]'`
Expected: includes `rabbit_####` sim names.

- [ ] **Step 4: Commit any build artifacts if the repo tracks them** (per existing `.gitignore`, `public/studio/` is ignored — nothing to commit here; the image build regenerates it).

---

## Self-Review

**Spec coverage:**
- Feature A meshtk fleet → Task 4. ✅
- Sim identities (rabbit_####) → Task 1. ✅
- Trust-boundary sim collection + real radio parity → Task 2. ✅
- Union + degrade-on-mesh-map-failure → Task 3. ✅
- Rabbit silhouette tinted per-color → Tasks 5–6. ✅
- Rich radio popup (Identity+Radio+battery) → Tasks 6–7. ✅
- Matrix rain + green tint on ghost activation → Tasks 8–9. ✅
- Reduced-motion static-tint fallback → Task 8. ✅
- Deploy recipe → in spec (run.mqtt buildpub + run.gpx buildpub → deploy use1). Applied at ship, not a code task.
- Real-rabbit blur follow-up → explicitly out of scope. ✅

**Type consistency:** `radioFields()` return shape is consumed identically in `simRabbitFeatureCollection`, `rabbitFeatureCollection` (Task 2) and the popup rows (Task 6). `pinColor` (not `pinIcon`) flows Task 2 → Task 6 → Task 7. `MatrixRain.start()/stop()` names match Task 8 ↔ Task 9. Sim slugs in `SIM_RABBITS` (Task 1) equal `LongNameTmpl` slugs and `NodeDbPath` basenames (Task 4).

**Placeholder scan:** no TBD/TODO; all code blocks concrete. Seed files are templated with an explicit "vary these fields" instruction and a full example — acceptable as they're repetitive data assets, not logic.
