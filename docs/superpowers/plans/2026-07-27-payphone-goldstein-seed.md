# PayPhone Beacon + Goldstein Unlock-Seed Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish two CTF clues on the gpx map — a ☎️ PayPhone beacon at The Strat ("Call me! 725-404-3234") and goldstein's DM-unlock TOTP seed (base32 + QR) in his gold-styled ghost popup.

**Architecture:** run.human gains an `x-internal-secret`-guarded `GET /api/internal/ghost-unlock` returning goldstein's live-derived unlock seed *and* a QR data-URI (run.human already has `qrcode`; run.gpx gains no deps). The run.gpx ghosts feed proxies that (fail-soft, module-cached) and attaches `unlockSeed`/`unlockQr` to goldstein's feature only. gpx-studio's ghost layer styles goldstein gold and renders the seed box; a new `payphone.ts` beacon clones `the-spot.ts`.

**Tech Stack:** Next.js 16 route handlers, vitest, mapbox-gl DOM markers/symbol match-expressions, `qrcode` (run.human, existing dep).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-payphone-goldstein-seed-design.md`
- PayPhone location (Nominatim, not eyeballed): `[-115.1561024, 36.1476992]`
- Popup copy: **"Call me! 725-404-3234"**; payphone accent `#F2A900`; goldstein gold `#FFD700` label / `#f5c518` wisp
- Expose ONLY the unlock seed (`revealGhostOtp` → `meshtk-otp-seed:` HKDF), never the chain seed
- Fail-soft everywhere: internal-call failure → plain dossier popup; never break the ghosts feed
- No infra/task-def changes; deploy via buildpub.yml + deploy.yml (GitHub Actions only)

---

### Task 1: run.human internal ghost-unlock endpoint

**Files:**
- Create: `apps/run.human/webapp/src/app/api/internal/ghost-unlock/route.ts`
- Test: `apps/run.human/webapp/src/app/api/internal/ghost-unlock/route.test.ts`

**Interfaces:**
- Consumes: `revealGhostOtp(ghostId)` from `@/lib/mesh-ghosts` (`{ghostId, configured, otpauth?, secret?}`), `config.auth.internalSecret`, `qrcode.toDataURL`
- Produces: `GET /api/internal/ghost-unlock?ghost=<fleetId>` → 200 `{ghostId, secret, otpauth, qr}` (qr = `data:image/png;base64,…`); 403 bad/missing header; 400 missing ghost; 422 unknown ghost or secret unconfigured

- [ ] **Step 1: Write failing test** (mirror mint-route guard conventions; drive `revealGhostOtp` via env + committed YAML snapshot):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config", () => ({ config: { auth: { internalSecret: "test-internal" } } }));

const OLD = process.env.MESHTK_GHOST_KEY_SECRET;
beforeEach(() => { process.env.MESHTK_GHOST_KEY_SECRET = "test-ghost-key"; });
afterEach(() => { process.env.MESHTK_GHOST_KEY_SECRET = OLD; });

function req(url: string, secret?: string) {
  return new NextRequest(`http://x${url}`, { headers: secret ? { "x-internal-secret": secret } : {} });
}

describe("GET /api/internal/ghost-unlock", () => {
  it("403s without the internal secret", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein"))).status).toBe(403);
  });
  it("400s without a ghost param", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/internal/ghost-unlock", "test-internal"))).status).toBe(400);
  });
  it("422s for an unknown ghost", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/internal/ghost-unlock?ghost=ghost.nope", "test-internal"))).status).toBe(422);
  });
  it("returns seed + otpauth + QR data-URI for goldstein", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein", "test-internal"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ghostId).toBe("ghost.goldstein");
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauth).toContain("otpauth://");
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/app/api/internal/ghost-unlock` → FAIL (module missing)
- [ ] **Step 3: Implement route** (guard identical to `internal/ctf/mint/route.ts:32-35`):

```ts
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { config } from "@/config";
import { revealGhostOtp } from "@/lib/mesh-ghosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: reveal a ghost's DM-unlock TOTP seed + enroll QR.
 * Sole caller: the run.gpx ghosts feed (goldstein map-popup CTF clue).
 * Exposes the UNLOCK seed only — never the chain/daily-claim seed.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ghostId = req.nextUrl.searchParams.get("ghost");
  if (!ghostId) return NextResponse.json({ error: "Missing ghost" }, { status: 400 });
  const reveal = revealGhostOtp(ghostId);
  if (!reveal?.configured || !reveal.otpauth || !reveal.secret) {
    return NextResponse.json({ error: "Unavailable" }, { status: 422 });
  }
  const qr = await QRCode.toDataURL(reveal.otpauth, { margin: 1, width: 220 });
  return NextResponse.json({ ghostId, secret: reveal.secret, otpauth: reveal.otpauth, qr });
}
```

- [ ] **Step 4:** re-run vitest → PASS (adjust only if `revealGhostOtp` 404-vs-422 semantics differ — unknown ghost returns `null` → 422 covers both)
- [ ] **Step 5:** `git commit -m "feat(human): internal ghost-unlock endpoint (seed + QR for map clue)"`

### Task 2: run.gpx feed enrichment (goldstein only)

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/ghost-unlock.ts`
- Modify: `apps/run.gpx/webapp/src/lib/mesh-nodes.ts:94-118` (`ghostFeatureCollection`)
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/public/ghosts/route.ts`
- Test: `apps/run.gpx/webapp/src/lib/__tests__/ghost-unlock.test.ts` (+ extend existing mesh-nodes tests if present, else assertions live here)

**Interfaces:**
- Consumes: Task 1's endpoint; env `RUN_HUMAN_INTERNAL_URL`, `AUTH_INTERNAL_SECRET` (copy the exact fallback pattern from `api/gpx/public/rabbits/route.ts:16-24`)
- Produces: `goldsteinUnlock(): Promise<GhostUnlock | null>` where `GhostUnlock = { secret: string; qr: string }`; `ghostFeatureCollection(db, unlock?: GhostUnlock | null)` adds `unlockSeed`/`unlockQr` properties to the goldstein feature only

- [ ] **Step 1: Write failing tests** — `ghost-unlock.ts` returns null on fetch failure / non-200 / missing fields, caches on success (mock `global.fetch`); `ghostFeatureCollection` with `{secret:"ABC…", qr:"data:image/png;base64,x"}` sets props on goldstein and on no other ghost; omits both when unlock is null.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3: Implement.** `ghost-unlock.ts`: module-level `let cached: GhostUnlock | null = null`; fetch `${RUN_HUMAN_URL}/api/internal/ghost-unlock?ghost=ghost.goldstein` with `{ cache: "no-store", headers: { "x-internal-secret": INTERNAL_SECRET }, signal: AbortSignal.timeout(3000) }`; validate `typeof secret === "string" && qr.startsWith("data:image/")`; try/catch → null (never throw). `mesh-nodes.ts`: optional param, inside the loop `...(slug === "goldstein" && unlock ? { unlockSeed: unlock.secret, unlockQr: unlock.qr } : {})`. `ghosts/route.ts`: `const unlock = await goldsteinUnlock();` → `ghostFeatureCollection(db, unlock)` (inside the existing try).
- [ ] **Step 4:** run → PASS; run full `npx vitest run` for run.gpx webapp — no regressions.
- [ ] **Step 5:** `git commit -m "feat(gpx): ghosts feed carries goldstein unlock seed + QR (internal proxy)"`

### Task 3: gpx-studio — goldstein gold pin + seed popup section

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/ghost-layer.ts`
- Modify: the stylesheet holding `.dc34-ghost-grid` (grep; expected `apps/run.gpx/gpx-studio/website/src/app.css` or `routes/app/+page.svelte` styles)

**Interfaces:**
- Consumes: feed props `unlockSeed`, `unlockQr` (Task 2), `slug`
- Produces: gold icon `dc34-ghost-icon-gold`; match-expression styling; `.dc34-ghost-seed` popup block

- [ ] **Step 1: Parameterize the wisp + register both images.** Replace the `GHOST_SVG` const with `ghostSvg(fill: string, stroke: string)` returning the same SVG with template colors; keep `const GHOST_SVG = ghostSvg('#9b5de5', '#e0aaff')` for the popup glyph; add `IMAGE_GOLD = 'dc34-ghost-icon-gold'` and load it from `ghostSvg('#f5c518', '#fff3c4')` in `loadImage()` (duplicate the `Image` dance for the second id).
- [ ] **Step 2: Data-drive the layer.** In `addLayer`: `'icon-image': ['match', ['get','slug'], 'goldstein', IMAGE_GOLD, IMAGE]`, `'icon-size': ['match', ['get','slug'], 'goldstein', 0.875, 0.7]`, paint `'text-color': ['match', ['get','slug'], 'goldstein', '#FFD700', '#e0aaff']`.
- [ ] **Step 3: Seed section in popup.** After the `link` const:

```ts
const seed = typeof p.unlockSeed === 'string' && p.unlockSeed ? String(p.unlockSeed) : '';
const qr = typeof p.unlockQr === 'string' && p.unlockQr.startsWith('data:image/') ? String(p.unlockQr) : '';
const seedBox = seed
    ? `<div class="dc34-ghost-seed"><span class="dc34-ghost-seed-k">🔑 SEED</span>` +
      `<code>${escapeHtml(seed)}</code>` +
      (qr ? `<img src="${qr}" alt="authenticator QR" width="110" height="110"/>` : '') +
      `<span class="dc34-ghost-seed-hint">enroll it · DM him the 6-digit code</span></div>`
    : '';
```

  append `${seedBox}` into `setHTML` before `${link}`; also wrap the goldstein head in gold: when `p.slug === 'goldstein'` add class `dc34-ghost-gold` to the `.dc34-ghost-reveal` wrapper.
- [ ] **Step 4: CSS** next to the existing `.dc34-ghost-*` rules: `.dc34-ghost-seed{border:1px solid #f5c518;border-radius:8px;padding:6px 8px;margin:6px 0;display:flex;flex-direction:column;gap:4px;align-items:flex-start}` `.dc34-ghost-seed code{font-size:11px;word-break:break-all;color:#ffd700}` `.dc34-ghost-seed img{border-radius:4px;background:#fff;padding:2px}` `.dc34-ghost-seed-k{font-weight:700;color:#ffd700}` `.dc34-ghost-seed-hint{font-size:10px;opacity:.75}` `.dc34-ghost-gold .dc34-ghost-name,.dc34-ghost-gold .dc34-ghost-alias{color:#ffd700}`
- [ ] **Step 5:** `git commit -m "feat(gpx-studio): goldstein gold pin + unlock-seed popup section"`

### Task 4: gpx-studio — PayPhone beacon + egg entry

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/payphone.ts`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte` (import :18 area, decl :59 area, instantiate after `theSpot` :298)
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.ts` (append after `dc34-coffee`)
- Test: `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.test.ts` (`EXPECTED_IDS` += `"dc34-payphone"`)

- [ ] **Step 1: `payphone.ts`** — byte-level clone of `the-spot.ts` with: `PAYPHONE_LOCATION = [-115.1561024, 36.1476992]`, `EGG_ID = 'dc34-payphone'`, `STYLE_ID = 'dc34-payphone-beacon-style'`, class `PayPhone`, emoji `☎️`, CSS class prefix `dc34-payphone-*`, ray/glow colors amber (`rgba(242,169,0,.7)` rays, drop-shadow `rgba(255,196,0,.95)`), label `PayPhone<br>The Strat`, `el.title = 'PayPhone — The Strat'`, keyframe names `dc34phonebob/spin/glow`.
- [ ] **Step 2: LayerControl** — `import { PayPhone } from '$lib/components/map/payphone';`, `let payPhone: PayPhone | undefined;`, and after the `theSpot` block: `if (payPhone) payPhone.remove(); payPhone = new PayPhone(_map); // click -> dc34-payphone modal. Pure clue, no CTF.`
- [ ] **Step 3: eggs entry** (after `dc34-coffee`, so EXPECTED_IDS appends at the end):

```ts
{
  id: "dc34-payphone",
  eyebrow: "Public Utility",
  title: "☎️ PayPhone",
  descriptionHtml:
    '<p><strong>Call me!</strong> <a href="tel:+17254043234">725-404-3234</a></p>',
  address: "The Strat, 2000 Las Vegas Blvd S",
  accent: "#F2A900",
  links: [mapLink(36.1476992, -115.1561024)],
},
```

- [ ] **Step 4:** update `EXPECTED_IDS`, run eggs route vitest → PASS.
- [ ] **Step 5:** `git commit -m "feat(gpx): PayPhone beacon at The Strat — dc34-payphone CTF clue"`

### Task 5: Full verification

- [ ] run.human: `npx vitest run` (full suite) + `npm run build` if feasible locally
- [ ] run.gpx webapp: `npx vitest run` (full suite)
- [ ] gpx-studio: `cd apps/run.gpx && ./build-frontend.sh` clean; `svelte-check` no NEW errors (baseline ~30 upstream)
- [ ] `git commit` any fixups

### Task 6: Ship (GitHub Actions only)

- [ ] Push branch, `gh pr create`, merge (pre-authorized), delete branch AFTER merge confirmed
- [ ] `gh workflow run buildpub.yml -f apps=run.human,run.gpx -f regions=use1` → watch
- [ ] `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true` → watch
- [ ] Live verify: `curl gpx.defcon.run/use1/api/gpx/public/ghosts` → goldstein feature has `unlockSeed` (32-char base32) + `unlockQr`; other ghosts don't. `curl gpx.defcon.run/use1/api/gpx/public/eggs` → `dc34-payphone` present with "Call me!". Optionally the Playwright prod-map probe for visual confirmation of gold pin + beacon.
