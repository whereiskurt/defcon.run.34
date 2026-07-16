# gpx map v2 — dcjack icons, 25-runner pack on real routes, matrix fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Swap the rabbit icon for a per-color-tinted dcjack at 50% opacity; add a 25-runner pack running the real LVCC Indoor route and move the 12 individuals onto 12 distinct real DC34 routes (so the runner layer is independent from the ghost tracks); and fix the ghost-mode matrix overlay so it actually renders.

**Architecture:** meshtk publishes sim nodes into `nodes.json`; the run.gpx proxy resolves them (static identity map) and unions with real rabbits; gpx-studio renders the rabbit layer + ghost matrix overlay. Real DC34 route GPX are embedded in meshtk so runners ride real routes.

**Tech Stack:** meshtk (Go/YAML), Next.js 16 + Vitest 4 (run.gpx webapp), Svelte/Vite (gpx-studio), Mapbox GL JS.

## Global Constraints

- Node ≥22.12 for vitest: `nvm use 23.6.0` before `npx vitest` in `apps/run.gpx/webapp`.
- Trust boundary unchanged: allowlist via `radioFields`; never emit keys/creds/`hash`; no raw-object spread. `escapeHtml` every popup value. pinColor resolves `|| DEFAULT_PIN_COLOR` (not `??`).
- Regex isolation: sim `/rabbit-sim/i` (incl. `rabbit-sim-pack-*`) vs ghost `/ghost|contest|operative/i`.
- meshtk changes are additive; the pack member's `Seed` is unique vs ghosts + the 12; ghost members other than `dt` untouched.
- **Prerequisite already staged upstream (`~/working/meshtk`, verified `go build` clean):** 15 real DC34 route GPX in `internal/embedded/gpx/runs/*.gpx` (lvccindoor, bigstar, east, frankie, history, littlestar, north, south, west, sign, original, othercons, tribute, lvccdds, lvccrebar) + embed directive updated to include `runs/*.gpx`. Build ships them via `apps/build.sh` cp of `~/working/meshtk`.

---

### Task 1: dcjack icon (tinted, 50% opacity)

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/dcjack-svg.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts`

- [ ] **Step 1: Create `dcjack-svg.ts`** — the circular DC jack path, fill = color:

```ts
/** DEF CON "jack" badge for the rabbit layer, tinted by the runner's pinColor.
 *  viewBox 0 0 200 200; one path. Color is our own pinColor (not an HTML sink). */
export function dcjackSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="${color}" d="M200,99.85c.09,55.23-44.64,100.06-99.85,100.15C44.92,200.09.08,155.39,0,100.15-.1,44.92,44.6.07,99.85,0c55.2-.09,100.07,44.61,100.15,99.85ZM100.76,128.94l-15.83-8.93-42.35,21.24c-1.31-4.35-4.96-7.45-9.26-7.45-5.39,0-9.77,4.9-9.77,10.91.01,6.01,4.39,10.88,9.78,10.87.56,0,1.09-.06,1.61-.13l.57,1.11c-1.49,1.89-2.36,4.34-2.36,6.99,0,5.89,4.38,10.65,9.77,10.65,5.4-.01,9.75-4.78,9.73-10.67,0-3.48-1.52-6.56-3.87-8.5l51.98-26.1ZM192.61,89.23c0-6.01-4.4-10.89-9.78-10.87-.86,0-1.68.12-2.46.36,1.87-1.99,3-4.79,3-7.89,0-6.02-4.39-10.87-9.78-10.87-5.39,0-9.76,4.89-9.74,10.9,0,3.06,1.13,5.8,2.94,7.77l-23.18,11.65c2.94-6.07,4.57-12.88,4.55-20.08-.03-25.46-20.71-46.09-46.2-46.05-25.46.04-46.1,20.73-46.04,46.2,0,4.64.69,9.09,1.96,13.31l-18.06-10.18c1.82-1.99,2.95-4.74,2.95-7.77,0-6.05-4.46-10.94-9.95-10.93-5.48,0-9.92,4.9-9.92,10.96,0,2.98,1.12,5.71,2.89,7.68-.68-.18-1.4-.25-2.12-.25-5.47.01-9.93,4.9-9.92,10.95.03,6.04,4.47,10.92,9.96,10.92,4.22,0,7.82-2.92,9.25-7.02l54.39,30.67,15.84,8.93,49.01,27.65c-1.01,1.87-1.61,4.17-1.61,6.65,0,6.23,3.76,11.26,8.37,11.26s8.35-5.05,8.33-11.29c0-3.89-1.48-7.36-3.74-9.36,1.36.84,2.99,1.34,4.69,1.34,5.06,0,9.13-4.3,9.13-9.59,0-5.32-4.1-9.6-9.14-9.6-3.97.01-7.35,2.65-8.6,6.38l-39.2-22.11-6.96-3.93c1.18-.29,2.36-.64,3.54-1.05l6.19,3.51,50.27-25.25c1.15,4.58,4.94,7.93,9.41,7.92,5.41,0,9.76-4.89,9.75-10.9ZM119.63,64.19c5.28,0,9.55-3.98,9.55-8.9-.02-4.9-4.29-8.86-9.58-8.86-5.29,0-9.56,3.98-9.56,8.89.01,4.92,4.3,8.89,9.59,8.87ZM87.68,64.24c5.28,0,9.55-3.99,9.55-8.9-.01-4.9-4.3-8.87-9.56-8.86-5.29,0-9.57,3.99-9.57,8.89,0,4.91,4.3,8.88,9.58,8.87ZM133.23,70.66c-2.61,0-4.73,1.2-4.74,2.67.03,1.15,1.31,2.11,3.07,2.5-1.87,13.84-14.04,24.55-28.79,24.57-14.74.02-26.95-10.64-28.89-24.49,1.81-.38,3.07-1.35,3.07-2.5,0-1.46-2.11-2.66-4.72-2.66-2.6,0-4.69,1.21-4.69,2.68,0,1.07,1.1,1.98,2.71,2.42,1.1,15.62,15.28,27.96,32.61,27.94,17.37-.03,31.52-12.44,32.56-28.09,1.51-.45,2.54-1.35,2.54-2.38,0-1.46-2.13-2.66-4.72-2.66Z"/></svg>`;
}
```

- [ ] **Step 2: Swap the icon in `rabbit-layer.ts`.** Change the import `import { rabbitSvg } from './rabbit-svg';` → `import { dcjackSvg } from './dcjack-svg';`. In `register()`, change the image id + source: `const iconId = ` `` `jack-${color}` `` `; this.loadSvgImage(iconId, dcjackSvg(color));`. In the `addLayer` layout, change `'icon-anchor': 'bottom'` → `'icon-anchor': 'center'`, set `'icon-size': 0.32`; in `paint`, add `'icon-opacity': 0.5`. Leave popup/clickFn, text, poll, source untouched.

- [ ] **Step 3: svelte-check**

Run: `cd apps/run.gpx/gpx-studio/website && nvm use 23.6.0 && npx svelte-check --threshold error`
Expected: error count unchanged from the pre-existing ~30 baseline (0 new from these files).

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/dcjack-svg.ts apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-layer.ts
git commit -m "feat(gpx-studio): dcjack icon (tinted, 50% opacity) for the rabbit layer"
```

---

### Task 2: pack identity resolver (distinct names)

**Files:**
- Modify: `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts`
- Modify: `apps/run.gpx/webapp/src/lib/mesh-nodes.ts`
- Test: `apps/run.gpx/webapp/src/lib/sim-rabbit-identities.test.ts`, `apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts`

**Interfaces:**
- Produces: `simRabbitIdentity(longName: string): SimRabbit | null` — pack (`rabbit-sim-pack-*`) → deterministic distinct `rabbit_####` + cycled color; individuals (`rabbit-sim-<slug>`) → `SIM_RABBITS[slug]`; else null. `mesh-nodes`' `simRabbitFeatureCollection` uses it.

- [ ] **Step 1: Failing tests** (append to `sim-rabbit-identities.test.ts`):

```ts
import { simRabbitIdentity } from "./sim-rabbit-identities";
describe("simRabbitIdentity", () => {
  it("resolves individuals via SIM_RABBITS", () => {
    expect(simRabbitIdentity("rabbit-sim-swift-00")).toEqual(SIM_RABBITS.swift);
  });
  it("gives each pack node a distinct deterministic rabbit_#### + color", () => {
    const a = simRabbitIdentity("rabbit-sim-pack-00");
    const b = simRabbitIdentity("rabbit-sim-pack-01");
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(a!.displayName).toMatch(/^rabbit_[0-9a-f]{4}$/);
    expect(a!.pinColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(a!.displayName).not.toBe(b!.displayName);            // distinct
    expect(simRabbitIdentity("rabbit-sim-pack-00")!.displayName).toBe(a!.displayName); // deterministic
  });
  it("returns null for unknown / non-sim names", () => {
    expect(simRabbitIdentity("rabbit-sim-nope-00")).toBeNull();
    expect(simRabbitIdentity("ghost-condor-00")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`simRabbitIdentity` not exported).

Run: `cd apps/run.gpx/webapp && nvm use 23.6.0 && npx vitest run src/lib/sim-rabbit-identities.test.ts`

- [ ] **Step 3: Implement** in `sim-rabbit-identities.ts`:

```ts
const PACK_PALETTE = ["#e6007a","#00d4aa","#7b61ff","#ff6b35","#00b4d8","#f15bb5","#ffd166","#06d6a0"];

/** 16-bit FNV-1a over the full node name → stable, format-agnostic. */
function hash16(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h ^ (h >>> 16)) & 0xffff;
}

/** Resolve a sim node's display identity from its full longName. */
export function simRabbitIdentity(longName: string): SimRabbit | null {
  if (/rabbit-sim-pack-/i.test(longName)) {
    const h = hash16(longName.toLowerCase());
    return { displayName: "rabbit_" + h.toString(16).padStart(4, "0"), pinColor: PACK_PALETTE[h % PACK_PALETTE.length] };
  }
  const slug = simRabbitSlug(longName);
  return (slug && simRabbit(slug)) || null;
}
```

- [ ] **Step 4: Wire into `mesh-nodes.ts`.** In `simRabbitFeatureCollection`, replace the `const slug = simRabbitSlug(...); const id = slug ? simRabbit(slug) : undefined;` lookup with `const id = simRabbitIdentity(n.longName as string);` (import `simRabbitIdentity`). Everything else (position gate, `radioFields`, keys stripped) unchanged. Add a mesh-nodes test: a `rabbit-sim-pack-03` node with a valid position emits a `rabbit_####` displayName + no keys.

- [ ] **Step 5: Run tests + tsc**

Run: `cd apps/run.gpx/webapp && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts apps/run.gpx/webapp/src/lib/sim-rabbit-identities.test.ts apps/run.gpx/webapp/src/lib/mesh-nodes.ts apps/run.gpx/webapp/src/lib/mesh-nodes.test.ts
git commit -m "feat(gpx): pack identity resolver — distinct rabbit_#### per pack node"
```

---

### Task 3: meshtk fleet — pack member, re-home individuals onto real routes, fix dt

**Files:**
- Modify: `apps/run.mqtt/meshtk/meshtk.dc34.yaml`

No unit test (config). Verify by grep + local meshtk build in Task 5.

- [ ] **Step 1: Add the pack member.** Append one Fleet member (mirror the existing rabbit member structure; unique `Seed` UUID):

```yaml
  - Id: "rabbit.pack"
    Description: "rabbit.pack (25-runner LVCC Indoor group run)"
    BehaviourTag: ["nodeinfo", "movement", "gitter"]
    BehaviourSecs: 30
    RampSteadySecs: 2419200
    Seed: "c0ffee01-2026-4dc3-9a11-000000000025"
    ShortNameTmpl: "RP{{.nodeId}}"
    LongNameTmpl: "rabbit-sim-pack-{{.nodeId}}"
    NodesPerRampInterval: [25]
    RampUpSecs: 2
    RampDownSecs: 2
    NodesPerSteadyInterval: [25]
    Distribution: "uniform"
    BroadcastGitterSec: 600
    LatLongAltGitter: 5000
    TextMessageGitterSec: 300
    Movement:
      - Type: "gpx"
        GPXFile: "./lvccindoor.gpx"
        Travel: "loop"
```

- [ ] **Step 2: Re-home the 12 individuals.** For each existing `rabbit.<slug>` member, change ONLY its `Movement.GPXFile` line from the ghost track to its assigned real route (1:1):

| member | new GPXFile |
|---|---|
| rabbit.swift | `./bigstar.gpx` |
| rabbit.dash | `./east.gpx` |
| rabbit.comet | `./frankie.gpx` |
| rabbit.nova | `./history.gpx` |
| rabbit.echo | `./littlestar.gpx` |
| rabbit.vega | `./north.gpx` |
| rabbit.orbit | `./south.gpx` |
| rabbit.pixel | `./west.gpx` |
| rabbit.raven | `./sign.gpx` |
| rabbit.scout | `./original.gpx` |
| rabbit.ember | `./othercons.gpx` |
| rabbit.frost | `./tribute.gpx` |

Leave every other field (Seed, LongNameTmpl, NodeDbPath, etc.) untouched.

- [ ] **Step 3: Fix the dt ghost.** Find the `ghost.dt` member. Its `Movement.GPXFile` points at a non-existent `./dt.gpx`. Change it to `./lvccdds.gpx` (a real LVCC route — The Dark Tangent now appears at LVCC as a ghost). Do not touch other ghost members.

- [ ] **Step 4: Verify structure**

Run: `grep -c 'LongNameTmpl: "rabbit-sim-' apps/run.mqtt/meshtk/meshtk.dc34.yaml` → expect `13` (12 individuals + pack).
Run: `python3 -c "import yaml; d=yaml.safe_load(open('apps/run.mqtt/meshtk/meshtk.dc34.yaml')); print('fleet:', len(d['Fleet']))"` → parses; fleet count = previous + 1.
Run: `grep -E 'GPXFile:' apps/run.mqtt/meshtk/meshtk.dc34.yaml | grep -cE 'bigstar|east|frankie|history|littlestar|north|south|west|sign|original|othercons|tribute|lvccindoor|lvccdds'` → expect `14` (12 individuals + pack + dt).

- [ ] **Step 5: Commit**

```bash
git add apps/run.mqtt/meshtk/meshtk.dc34.yaml
git commit -m "feat(mesh): 25-runner pack on LVCC Indoor; move sim rabbits to real DC34 routes; fix dt ghost"
```

---

### Task 4: matrix fix (render over the light basemap)

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/app.css`

- [ ] **Step 1: Mount the overlay on `document.body`.** In `ghost-layer.ts`, change the constructor line `this.matrix = new MatrixRain(map.getContainer());` → `this.matrix = new MatrixRain(document.body);`. (Escapes the map's stacking context — the leading cause of the invisible overlay.) No other wiring change.

- [ ] **Step 2: Fix the CSS** in `app.css`. Replace the two `.dc34-matrix-*` rule blocks with:

```css
.dc34-matrix-canvas {
    position: fixed; inset: 0; z-index: 2147483001; pointer-events: none;
    opacity: 0; transition: opacity 500ms ease;
}
.dc34-matrix-canvas.on { opacity: 0.55; }
.dc34-matrix-tint {
    position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
    background: rgba(0, 70, 20, 0.55);
    mix-blend-mode: multiply; opacity: 0; transition: opacity 600ms ease;
}
.dc34-matrix-tint.on { opacity: 1; }
```

(High z-index beats studio chrome; `multiply` green darkens the light basemap into a green wash — visible where `screen` was not.)

- [ ] **Step 3: svelte-check**

Run: `cd apps/run.gpx/gpx-studio/website && nvm use 23.6.0 && npx svelte-check --threshold error`
Expected: baseline unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts apps/run.gpx/gpx-studio/website/src/app.css
git commit -m "fix(gpx-studio): render matrix overlay — body-mount + high z-index + green multiply tint"
```

---

### Task 5: integration build + live verification

**Files:** none (verification only).

- [ ] **Step 1: meshtk builds with the pack config + embedded routes.**

Run: `cd ~/working/meshtk && go build ./... 2>&1 | tail -5; echo EXIT=$?`
Expected: EXIT=0 (embedded `runs/*.gpx` compile; the 15 route GPX are present).

- [ ] **Step 2: Build the studio + run the full webapp suite.**

Run: `cd apps/run.gpx && ./build-frontend.sh` (expect success, studio artifact written).
Run: `cd apps/run.gpx/webapp && nvm use 23.6.0 && npx vitest run && npx tsc --noEmit` (expect all pass).

- [ ] **Step 3: LIVE matrix verification (this is a bug fix — observe it).** Start the studio dev server and drive it with Playwright:

Run: `cd apps/run.gpx/gpx-studio/website && (npm run dev >/tmp/studio-dev.log 2>&1 &) ` then wait for `:5173`.
Using the Playwright MCP tools: navigate to `http://localhost:5173/app` (or the studio route the dev server serves), dismiss any intro, type `!!!` to unlock ghost mode, take a screenshot. Confirm the green rain + tint are visible over the map; toggle ghost mode off and confirm they disappear (no leftover canvas). Also confirm the rabbit layer shows dcjack badges (tinted, semi-transparent). If the dev route can't be driven headlessly, record that as a human-gate UAT item and proceed (the fix directly addresses the root cause).

- [ ] **Step 4: Commit** any incidental fixes surfaced by verification (none expected). Studio artifact (`public/studio/`) is gitignored.

---

## Self-Review

**Spec coverage:** dcjack icon (T1) ✅; 25-pack distinct names (T2) + on LVCC Indoor (T3) ✅; runners re-homed to real routes off ghost tracks (T3, + embedded GPX prereq) ✅; dt ghost fix (T3) ✅; matrix fix (T4) ✅; live verify (T5) ✅.
**Type consistency:** `simRabbitIdentity` return type `SimRabbit | null` consumed in `mesh-nodes.ts`; `dcjackSvg(color)` mirrors `rabbitSvg`; `MatrixRain(parent)` unchanged (only the arg changes to `document.body`).
**Placeholder scan:** Seed UUID is a concrete literal; route table is explicit; no TODO/TBD.
