# donate.defcon.run Vanity Subdomain + Read-only /admin/qr Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `donate.defcon.run` as a Terraform-managed vanity subdomain redirecting to the donate flow, and surface all vanity subdomains read-only inside `/admin/qr` — both fed by one shared `redirects.json`.

**Architecture:** Extract the inline `redirects.rules` HCL list from `site.hcl` into a single committed `apps/run.human/webapp/src/data/redirects.json`. Terraform's `redirect-rules` terragrunt unit reads it via `jsondecode(file(...))` (repo root discovered by `find_in_parent_folders("AGENTS.md")`); run.human imports the same file for a read-only admin panel. The file lives inside run.human because that app ships as a container whose build context is only `apps/run.human/webapp` — Terraform runs on a full checkout and reaches up to read it. One committed file, zero copy, zero drift.

**Tech Stack:** Terragrunt/Terraform (`cloudfront-redirect` module), Next.js 16 App Router (run.human), vitest ^4, GitHub Actions (`buildpub.yml` + `deploy.yml`).

## Global Constraints

- **`redirects.json` is the single source of truth.** Read by Terraform (`redirect-rules/terragrunt.hcl`) and imported by run.human (`/admin/qr`). Never duplicate the list anywhere else.
- **`status_code` is a string enum:** `"HTTP_301"` or `"HTTP_302"` (never numeric). The module maps these to 301/302 internally.
- **run.human basePath is `/use1`.** Any URL into run.human must include it (`target_path = "/use1/..."`) or it 404s.
- **`og.image` is an absolute URL** used in `og:image`/`twitter:image` meta tags. **`og.image_file`** (optional) is a filename in the module `assets/` dir, uploaded to `s3://bucket/<host>/<file>` and served at `https://<host>.defcon.run/<file>`. A host wanting a card image sets **both** — `image` to the served URL, `image_file` to the local filename.
- **OG card PNGs are 1200×630** (the template hardcodes `og:image:width/height`).
- **r/h/sao must not change.** The JSON extraction is a pure refactor: a `terragrunt plan` on `redirect-rules` after Task 1 must show **no changes** to the existing three distributions.
- **vitest needs Node ≥22.12** (use `nvm use 24` or `nvm use 22.12`; the default v22.1.0 / odd v23.6.0 fail). Run tests with `npx vitest run <path>`. There is no `test` npm script.
- **Deploy recipe (run.human → use1):** `gh workflow run buildpub.yml -f apps=run.human -f regions=use1 -f deploy=false`, then `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true`. `deploy` MUST stay false on buildpub.

---

## File Structure

**Created:**
- `apps/run.human/webapp/src/data/redirects.json` — canonical vanity-redirect list (r/h/sao/donate). Read by Terraform + run.human.
- `apps/run.human/webapp/src/lib/vanity-redirects.ts` — pure loader/validator: `redirects.json` → typed `VanityRedirect[]` with computed `targetUrl`/`splash`. The panel's only logic.
- `apps/run.human/webapp/src/lib/vanity-redirects.test.ts` — vitest coverage of the loader + a shape/parity guard on `redirects.json`.
- `infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.src.html` — source HTML for the donate OG card (1200×630).
- `infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png` — rendered OG card, uploaded by the module.

**Modified:**
- `infra/terraform/live/site/site.hcl:516-567` — `redirects` local loses its inline `rules` array; keeps `enabled`.
- `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl:80` — `redirects` input now `jsondecode(file(...))` from `redirects.json`.
- `apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx` — new read-only "Vanity subdomains" `<section>`.

---

## Task 1: Extract redirect list to shared `redirects.json` (pure refactor)

Move r/h/sao out of `site.hcl` into `redirects.json`, point Terraform at it. No infra change.

**Files:**
- Create: `apps/run.human/webapp/src/data/redirects.json`
- Modify: `infra/terraform/live/site/site.hcl:516-567`
- Modify: `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl:80`

**Interfaces:**
- Produces: `redirects.json` — a JSON array of redirect objects, each `{ host, target_host, target_path, target_query, status_code, priority, splash_style?, covert_v?, og: { title, description, image, image_file? } }`. Consumed by Task 3 (append donate) and Task 4 (`loadVanityRedirects`).

- [ ] **Step 1: Create `redirects.json` with r/h/sao verbatim**

Create `apps/run.human/webapp/src/data/redirects.json` — transcribe the three objects from `site.hcl` exactly (same values, `status_code` as strings). Comments are dropped (JSON); the sao `covert_v` provenance moves to a `site.hcl` comment in Step 3.

```json
[
  {
    "host": "r",
    "target_host": "www.youtube.com",
    "target_path": "/watch",
    "target_query": "v=dQw4w9WgXcQ",
    "status_code": "HTTP_302",
    "priority": 90,
    "og": {
      "title": "Run Hacker Run! — DEF CON 34 Remaster",
      "description": "Running was their real crime. Mess with the best, run like the rest. ▶ Watch the feature presentation now.",
      "image": "https://r.defcon.run/hackers.png",
      "image_file": "hackers.png"
    }
  },
  {
    "host": "h",
    "target_host": "run.defcon.run",
    "target_path": "/",
    "target_query": "",
    "status_code": "HTTP_301",
    "priority": 91,
    "og": {
      "title": "defcon.run 34 — it's happening",
      "description": "defcon.run 34 is happening. Get your bib, check the maps, and flash your Meshtastic device. An official DEF CON 34 event in Las Vegas.",
      "image": "https://defcon.run/og.png"
    }
  },
  {
    "host": "sao",
    "target_host": "bib.defcon.run",
    "target_path": "/",
    "target_query": "",
    "status_code": "HTTP_302",
    "priority": 92,
    "splash_style": "countdown",
    "covert_v": "7923716986449251596374660747179",
    "og": {
      "title": "DC34-SAO-01 — Sh*tty Add-On (v1.69bis)",
      "description": "The DEF CON 34 SAO that pairs with your Meshtastic node. I²C, 6-pin, 1.1 millihorsepower. 1 per DC34 run kit.",
      "image": "https://sao.defcon.run/sao.png",
      "image_file": "sao.png"
    }
  }
]
```

- [ ] **Step 2: Verify the JSON parses and has 3 hosts**

Run: `node -e "const r=require('./apps/run.human/webapp/src/data/redirects.json'); console.log(r.length, r.map(x=>x.host).join(','))"`
Expected: `3 r,h,sao`

- [ ] **Step 3: Strip the inline `rules` from `site.hcl`**

In `infra/terraform/live/site/site.hcl`, replace the whole `redirects = { ... }` block (lines 516-567) with the `enabled`-only version below. The comment now documents that rules live in `redirects.json`, and preserves the sao `covert_v` provenance that the JSON can't carry.

```hcl
  # Vanity host redirects (QR service Phase 1) — served as S3-hosted interstitial
  # pages behind per-host CloudFront distributions. Crawlers read the og.* tags
  # (the unfurl card); humans are redirected client-side to target_*.
  #
  # The per-host RULES now live in the single source of truth
  #   apps/run.human/webapp/src/data/redirects.json
  # (also imported by run.human's read-only /admin/qr vanity panel). The
  # redirect-rules unit loads it via jsondecode(). This `enabled` flag stays here
  # as the Terraform kill switch — set false to ship the whole unit dark.
  #
  # og.image is an absolute URL (the unfurl card). og.image_file (optional) uploads
  # a local file from the cloudfront-redirect module's assets/ dir to the host's S3
  # prefix. sao's covert_v = encodeFlag("sao-egg","sao"), pinned by
  # ctf-covert-codec.test.ts (SAO_SPLASH_COVERT_V); the sao-egg Ctf row is admin-
  # created in run.human (answer "sao").
  redirects = {
    enabled = true
  }
```

- [ ] **Step 4: Point the terragrunt unit at `redirects.json`**

In `infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl`, change line 80 from:

```hcl
  redirects = local.site_vars.locals.redirects.rules
```

to (repo root is discovered exactly as the `source` on line 65 does — `find_in_parent_folders("AGENTS.md")`):

```hcl
  redirects = jsondecode(file("${dirname(find_in_parent_folders("AGENTS.md"))}/apps/run.human/webapp/src/data/redirects.json"))
```

The `exclude` block on line 26 still reads `local.site_vars.locals.redirects.enabled` — unchanged, still valid.

- [ ] **Step 5: Format + validate the terragrunt/HCL**

Run: `cd infra/terraform/live/site/region/us-east-1/redirect-rules && terragrunt hclfmt && terragrunt validate`
Expected: hclfmt reports no diff (or formats cleanly); validate succeeds. (`validate` runs without AWS state.)

- [ ] **Step 6: Prove NO infra change (plan)**

Run a scoped plan. If you have fresh SSO creds locally:
`cd infra/terraform/live/site/region/us-east-1/redirect-rules && terragrunt plan`
Expected: **`No changes. Your infrastructure matches the configuration.`**

If local AWS creds are unavailable, dispatch the plan CI action instead (documented in the unit header, terragrunt.hcl:18-19):
`gh workflow run terragrunt-plan.yml -f region=us-east-1 -f modules=redirect-rules`
Then check the run: `gh run list --workflow=terragrunt-plan.yml --limit 1` → open it → confirm **no changes** to `aws_cloudfront_distribution.redirect`, `aws_s3_object.index/image`, `aws_route53_record.redirect_alias`. If the plan shows ANY change to r/h/sao, a value was transcribed wrong in Step 1 — fix and re-plan.

- [ ] **Step 7: Commit**

```bash
git add apps/run.human/webapp/src/data/redirects.json infra/terraform/live/site/site.hcl infra/terraform/live/site/region/us-east-1/redirect-rules/terragrunt.hcl
git commit -m "refactor(infra): extract vanity redirects to shared redirects.json

Single source of truth for r/h/sao vanity subdomains, read by both the
redirect-rules terragrunt unit (jsondecode) and run.human's admin panel.
Pure refactor — plan shows no changes."
```

---

## Task 2: Donate OG card art (`donate-card.src.html` → `donate-card.png`)

Produce a 1200×630 PNG matching the static "Donate" tile identity (Chip In · 05·GIVE · heart), following the existing `*-card.src.html` → `*.png` pattern in the assets dir.

**Files:**
- Create: `infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.src.html`
- Create: `infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png`

**Interfaces:**
- Produces: `donate-card.png` (1200×630) at the module `assets/` path, referenced by `og.image_file` in Task 3. `filemd5()` in the module requires this file to exist before any plan/apply of the donate host.

- [ ] **Step 1: Create the card source HTML**

Create `infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.src.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: radial-gradient(120% 120% at 15% 0%, #0d1512 0%, #060908 60%, #030504 100%);
    color: #e7fff5; font-family: "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 64px 72px; position: relative; overflow: hidden;
  }
  .wordmark { font-size: 40px; font-weight: 700; letter-spacing: -0.5px; color: #e7fff5; }
  .wordmark .dot { color: #2dd4bf; }
  .tag {
    display: inline-block; font-family: "SF Mono", ui-monospace, Menlo, monospace;
    font-size: 22px; letter-spacing: 4px; color: #2dd4bf;
    border: 1px solid rgba(45,212,191,0.4); border-radius: 999px; padding: 8px 20px;
  }
  .center { display: flex; align-items: center; gap: 40px; }
  .heart { font-size: 168px; line-height: 1; color: #2dd4bf; filter: drop-shadow(0 0 40px rgba(45,212,191,0.45)); }
  .headline { font-size: 132px; font-weight: 800; letter-spacing: -3px; line-height: 0.92; }
  .headline .give { color: #2dd4bf; }
  .sub { font-size: 30px; color: #9fdccb; letter-spacing: 0.5px; }
  .foot { display: flex; align-items: center; justify-content: space-between; }
  .url { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 26px; color: #2dd4bf; }
</style>
</head>
<body>
  <div class="wordmark">defcon<span class="dot">.</span>run <span style="opacity:.5">34</span></div>
  <div class="center">
    <div class="heart">&#9829;</div>
    <div>
      <div class="headline">CHIP <span class="give">IN</span></div>
      <div class="sub" style="margin-top:16px">Support defcon.run — an official DEF CON 34 event</div>
    </div>
  </div>
  <div class="foot">
    <span class="tag">05 &middot; GIVE</span>
    <span class="url">donate.defcon.run</span>
  </div>
</body>
</html>
```

- [ ] **Step 2: Render it to a 1200×630 PNG**

Playwright with chromium is already installed in `apps/run.auth/e2e` (see AGENTS.md e2e setup). Create a throwaway render script `apps/run.auth/e2e/render-donate-card.mjs`:

```js
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const src = resolve(
  "../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.src.html"
);
const out = resolve(
  "../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png"
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log("wrote", out);
```

Run: `cd apps/run.auth/e2e && node render-donate-card.mjs`
Expected: `wrote /…/assets/donate-card.png`

- [ ] **Step 3: Verify the PNG dimensions**

Run: `cd apps/run.auth/e2e && node -e "import('playwright').then(async({chromium})=>{}); " ; file ../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png`
Expected: output includes `PNG image data, 1200 x 630`.
(If `file` is unavailable, run `node -e "const s=require('fs').statSync('../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png'); console.log(s.size>10000?'ok':'too small')"` → `ok`.)

- [ ] **Step 4: Remove the throwaway render script and commit the card**

```bash
/bin/rm apps/run.auth/e2e/render-donate-card.mjs
git add infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.src.html infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/donate-card.png
git commit -m "feat(infra): add donate OG card art (1200x630) for donate.defcon.run"
```

---

## Task 3: Add `donate` to `redirects.json` and provision the subdomain in plan

**Files:**
- Modify: `apps/run.human/webapp/src/data/redirects.json`

**Interfaces:**
- Consumes: `redirects.json` (Task 1), `donate-card.png` (Task 2).
- Produces: a fourth redirect object `donate` that later tasks (panel) render and the deploy task applies.

- [ ] **Step 1: Append the donate object**

Add this object to the `redirects.json` array (after `sao`). `image` is the served URL of the uploaded `image_file`; `target_path` carries the `/use1` basePath.

```json
  {
    "host": "donate",
    "target_host": "run.defcon.run",
    "target_path": "/use1/whoami",
    "target_query": "open=donate",
    "status_code": "HTTP_302",
    "priority": 93,
    "og": {
      "title": "Chip In — DEF CON 34",
      "description": "Support defcon.run — an official DEF CON 34 event in Las Vegas. Every bit helps us put on the run.",
      "image": "https://donate.defcon.run/donate-card.png",
      "image_file": "donate-card.png"
    }
  }
```

- [ ] **Step 2: Verify the JSON parses and now has 4 hosts including donate**

Run: `node -e "const r=require('./apps/run.human/webapp/src/data/redirects.json'); const d=r.find(x=>x.host==='donate'); console.log(r.length, !!d, d.target_host+d.target_path+'?'+d.target_query)"`
Expected: `4 true run.defcon.run/use1/whoami?open=donate`

- [ ] **Step 3: Plan — expect exactly one new host (donate), r/h/sao unchanged**

Run (fresh SSO creds): `cd infra/terraform/live/site/region/us-east-1/redirect-rules && terragrunt plan`
Expected: a plan that **adds** `donate`-keyed resources only —
`aws_cloudfront_distribution.redirect["donate"]`, `aws_s3_object.index["donate"]`, `aws_s3_object.image["donate"]`, `aws_route53_record.redirect_alias["donate"]`, `aws_cloudfront_function.redirect["donate"]` — and shows **no changes** to r/h/sao. (Creds unavailable → dispatch `gh workflow run terragrunt-plan.yml -f region=us-east-1 -f modules=redirect-rules` and inspect.)
If the plan errors with `filemd5: no file exists` for `donate-card.png`, Task 2 didn't land — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/run.human/webapp/src/data/redirects.json
git commit -m "feat(infra): add donate.defcon.run vanity subdomain -> whoami donate flow"
```

---

## Task 4: run.human `vanity-redirects` loader + tests

Pure, testable logic that turns `redirects.json` into what the panel renders. Keeps the server component dumb.

**Files:**
- Create: `apps/run.human/webapp/src/lib/vanity-redirects.ts`
- Test: `apps/run.human/webapp/src/lib/vanity-redirects.test.ts`

**Interfaces:**
- Consumes: `src/data/redirects.json`.
- Produces:
  - `type VanityRedirect = { host: string; fqdn: string; targetUrl: string; splash: string; statusCode: string }`
  - `function loadVanityRedirects(): VanityRedirect[]` — sorted by `priority` asc, each with `fqdn = "<host>.defcon.run"`, `targetUrl` built from target_host/path/query, `splash = splash_style ?? "hackers"`. Throws if a record is missing a required field.

- [ ] **Step 1: Write the failing test**

Create `apps/run.human/webapp/src/lib/vanity-redirects.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadVanityRedirects } from "./vanity-redirects";

describe("loadVanityRedirects", () => {
  const all = loadVanityRedirects();

  it("includes donate mapped to the whoami donate flow", () => {
    const donate = all.find((r) => r.host === "donate");
    expect(donate).toBeDefined();
    expect(donate!.fqdn).toBe("donate.defcon.run");
    expect(donate!.targetUrl).toBe("https://run.defcon.run/use1/whoami?open=donate");
    expect(donate!.splash).toBe("hackers");
    expect(donate!.statusCode).toBe("HTTP_302");
  });

  it("defaults splash to hackers and honors countdown", () => {
    expect(all.find((r) => r.host === "sao")!.splash).toBe("countdown");
    expect(all.find((r) => r.host === "r")!.splash).toBe("hackers");
  });

  it("builds targetUrl without a trailing ? when query is empty", () => {
    expect(all.find((r) => r.host === "h")!.targetUrl).toBe("https://run.defcon.run/");
  });

  it("returns hosts sorted by priority", () => {
    const hosts = all.map((r) => r.host);
    expect(hosts).toEqual(["r", "h", "sao", "donate"]);
  });

  it("every record has required fields", () => {
    for (const r of all) {
      expect(r.host).toBeTruthy();
      expect(r.fqdn).toContain(".defcon.run");
      expect(r.targetUrl.startsWith("https://")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/vanity-redirects.test.ts`
Expected: FAIL — `Failed to resolve import "./vanity-redirects"` (module doesn't exist yet). (Ensure Node ≥22.12: `nvm use 24` first.)

- [ ] **Step 3: Implement the loader**

Create `apps/run.human/webapp/src/lib/vanity-redirects.ts`:

```ts
import redirects from "@/data/redirects.json";

/** One Terraform-managed vanity subdomain, shaped for read-only display. */
export type VanityRedirect = {
  host: string;
  fqdn: string;
  targetUrl: string;
  splash: string;
  statusCode: string;
};

type RawRedirect = {
  host: string;
  target_host: string;
  target_path: string;
  target_query: string;
  status_code: string;
  priority?: number;
  splash_style?: string;
};

/**
 * Load the vanity-redirect list from the shared redirects.json — the same file
 * the redirect-rules terragrunt unit reads. Read-only source of truth; edits go
 * to redirects.json + a terraform apply, never through the UI.
 */
export function loadVanityRedirects(): VanityRedirect[] {
  const raw = redirects as RawRedirect[];
  return raw
    .map((r) => {
      if (!r.host || !r.target_host) {
        throw new Error(`redirects.json: record missing host/target_host: ${JSON.stringify(r)}`);
      }
      const query = r.target_query ? `?${r.target_query}` : "";
      return {
        host: r.host,
        fqdn: `${r.host}.defcon.run`,
        targetUrl: `https://${r.target_host}${r.target_path}${query}`,
        splash: r.splash_style ?? "hackers",
        statusCode: r.status_code,
      };
    })
    .sort((a, b) => {
      const pa = raw.find((x) => x.host === a.host)?.priority ?? 0;
      const pb = raw.find((x) => x.host === b.host)?.priority ?? 0;
      return pa - pb;
    });
}
```

- [ ] **Step 4: Confirm `resolveJsonModule` is enabled (tsconfig)**

Run: `cd apps/run.human/webapp && node -e "const t=require('./tsconfig.json'); console.log(t.compilerOptions && t.compilerOptions.resolveJsonModule)"`
Expected: `true`. If it prints `undefined`/`false`, add `"resolveJsonModule": true` to `compilerOptions` in `apps/run.human/webapp/tsconfig.json` (Next.js sets this by default, so it is almost certainly already true).

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/vanity-redirects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/lib/vanity-redirects.ts apps/run.human/webapp/src/lib/vanity-redirects.test.ts
git commit -m "feat(run.human): vanity-redirects loader over shared redirects.json"
```

---

## Task 5: Read-only "Vanity subdomains" panel in /admin/qr

**Files:**
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx`

**Interfaces:**
- Consumes: `loadVanityRedirects()` (Task 4), `cls` from `@/components/admin/qr-ui`.

- [ ] **Step 1: Import the loader**

At the top of `page.tsx`, add to the existing imports (after line 3's `qr-admin` import):

```ts
import { loadVanityRedirects } from "@/lib/vanity-redirects";
```

- [ ] **Step 2: Load the list in the component**

Inside `QrAdminPage`, after the `sortedChallenges` declaration (line 32), add:

```ts
  const vanity = loadVanityRedirects();
```

- [ ] **Step 3: Add the read-only section**

Insert this `<section>` immediately after the closing `</section>` of the CTF challenges block (after line 194, before the trailing `<p>` on line 196):

```tsx
      {/* Vanity subdomains — Terraform-managed, read-only */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className={cls.h2}>Vanity subdomains ({vanity.length})</h2>
        </div>
        <div className={`${cls.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={`${cls.table} min-w-[640px]`}>
              <thead className={cls.thead}>
                <tr>
                  {["Host", "Target", "Splash", "Status"].map((c, i) => (
                    <th key={c || i} className={cls.th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vanity.map((row) => (
                  <tr key={row.host} className={cls.tr}>
                    <td className={cls.td}>
                      <span className="text-primary font-mono">{row.fqdn}</span>
                    </td>
                    <td
                      className={`${cls.td} max-w-[340px] truncate`}
                      title={row.targetUrl}
                    >
                      {row.targetUrl}
                    </td>
                    <td className={`${cls.td} text-default-500`}>{row.splash}</td>
                    <td className={cls.td}>
                      <span className="text-primary">live</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11.5px] text-default-400">
          Terraform-managed — edit{" "}
          <code>apps/run.human/webapp/src/data/redirects.json</code> and apply the{" "}
          <code>redirect-rules</code> unit. Not editable here.
        </p>
      </section>
```

- [ ] **Step 4: Typecheck / build the app**

Run: `cd apps/run.human/webapp && npx tsc --noEmit -p tsconfig.json`
Expected: no errors introduced by this change. (Pre-existing unrelated errors may exist; none should reference `vanity-redirects` or `page.tsx`.)

- [ ] **Step 5: Re-run the lib test (guards the JSON the panel renders)**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/vanity-redirects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx"
git commit -m "feat(run.human): read-only vanity-subdomains panel in /admin/qr"
```

---

## Task 6: Deploy + UAT (two surfaces)

The subdomain (Terraform) and the panel (run.human release) deploy independently; order doesn't matter.

**Files:** none (deploy/verify only).

- [ ] **Step 1: Push the branch and open/merge a PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: donate.defcon.run vanity subdomain + read-only /admin/qr panel" --fill
```
Wait for user approval before merging (AGENTS.md: never auto-merge without explicit instruction). On approval: `gh pr merge <n> --squash --admin`.

- [ ] **Step 2: Apply the subdomain (Terraform)**

With SSO creds that include the management-account Route53 role + site-account CF/S3:
```bash
cd infra/terraform/live/site/region/us-east-1/redirect-rules && terragrunt apply
```
Expected: creates the `donate` distribution, S3 objects, and apex ALIAS. The new CloudFront distribution takes ~15–20 min to reach `Deployed`.

- [ ] **Step 3: Release run.human (the panel)**

```bash
gh workflow run buildpub.yml -f apps=run.human -f regions=use1 -f deploy=false
# wait for success + Release PR merge, then:
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true
```
Verify each: `gh run view <id> --json conclusion` → `success`. (If buildpub fails on an immutable-tag ECR collision, re-run buildpub — it bumps past the collision. See the run.flash deploy notes.)

- [ ] **Step 4: UAT the subdomain**

Once the distribution is `Deployed`:
```bash
curl -sSL -o /dev/null -w "%{http_code} -> %{url_effective}\n" https://donate.defcon.run
```
Expected: reaches the interstitial then `https://run.defcon.run/use1/whoami?open=donate`. In a browser: `https://donate.defcon.run` → splash/unfurl card → whoami → (after login) donate modal opens. Confirm the unfurl card by pasting the URL into a link-preview tool or Slack — it should show the donate card art + "Chip In — DEF CON 34".

- [ ] **Step 5: UAT the panel**

Visit `https://run.defcon.run/use1/admin/qr` (admin session). Confirm the new "Vanity subdomains (4)" section lists r / h / sao / donate with correct targets, splash, and a `live` status.

- [ ] **Step 6: Update memory**

Record shipped state in `project_static_donate_tile.md` (or a new `project_donate_vanity_subdomain.md`): `donate.defcon.run` live, fed by shared `redirects.json`, read-only /admin/qr panel, deploy recipe + the redirects.json single-source pattern. Link `[[project_static_donate_tile]]`.

---

## Self-Review

**Spec coverage:**
- Single source of truth `redirects.json` → Task 1. ✓
- File lives in run.human, Terraform reads via `jsondecode` + repo-root discovery → Task 1 Steps 3-4. ✓
- Pure-refactor no-change proof → Task 1 Step 6. ✓
- `donate.defcon.run` → whoami donate flow, one appended object, no new TF resources → Task 3. ✓
- Branded OG card art (in scope) → Task 2 + Task 3 `og.image`/`image_file`. ✓
- Read-only panel, Host/Target/Splash/Status, `live` chip, "not editable here" caption → Task 5. ✓
- Two donate entry points (q.defcon.run/donate untouched) → no task needed; the resolver/`Qr` data model is not touched by any task. ✓
- Deploy: subdomain apply + run.human release → Task 6. ✓
- Parity/shape guard → Task 4 test (`every record has required fields`, targetUrl/splash correctness). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete content; the two spec "open questions" (Terragrunt path helper, art export) are resolved concretely in Tasks 1 and 2.

**Type consistency:** `loadVanityRedirects()` / `VanityRedirect { host, fqdn, targetUrl, splash, statusCode }` defined in Task 4 and consumed identically in Task 5. `redirects.json` object shape (`host`, `target_host`, `target_path`, `target_query`, `status_code`, `priority`, `splash_style?`, `covert_v?`, `og{title,description,image,image_file?}`) is consistent across Tasks 1, 3, and the `RawRedirect` type in Task 4.
