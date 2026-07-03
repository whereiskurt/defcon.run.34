# v1.6 — Bib Refresh & Admin Reporting

**Workstream:** v1-6-bib-refresh
**Branch:** `gsd/v1.6-bib-refresh` (off `origin/main`, in worktree `~/gsd-workspaces/v1-5-bib/defcon.run.34`)
**Started:** 2026-07-03 · **Base:** run.bib live at v0.0.18
**Design source:** Kurt brainstorm 2026-07-03 (this session)

Builds on the shipped v1.5 bib app (`bib.defcon.run`, deployed). Two phases: a full design-system
port + UX cleanup (Phase A), and a gated admin reporting dashboard (Phase B). Parallel-safe with
other workstreams — touches only `apps/run.bib/` (+ one `apps/local/dynamodb` helper).

---

## Locked decisions (Kurt 2026-07-03)

- **Look & feel:** FULL HeroUI port — bib becomes a real sibling of run.human (real HeroUI Navbar
  with user dropdown + theme switch, Vegas parallax background, forms rewritten in HeroUI/Tailwind).
  Accepted the higher change-surface over the lightweight CSS-only option.
- **Admin auth:** all admin pages gate on the **`"admin"` group** = `session.user.services.includes("admin")`
  (the run.human canonical pattern), NOT the SSM email allowlist. Drop the SSM allowlist machinery.
- **Kurt granted admin:** DONE — `"admin"` appended to his `services` in `run-auth-electro`
  (`$oidc#userid_c01222e2-…` / `$authprofile_1`). Propagates to session within ~5 min. Jesse still
  needs the same grant when his sub is known.
- **Reports:** all four (print-name, payments/revenue, outstanding+in-person, all registrations),
  delivered as a gated `/admin` dashboard page with per-report CSV download. Reference logic already
  exists in `apps/run.bib/scripts/bib-report.sh`.
- **User reset:** DONE — Kurt's Bib + GeneralDonation rows deleted (both Stripe test-mode); he's a
  fresh regular user.

---

## Phase A — Bib UX Refresh

### A1. Design-system foundation (port run.human's stack into run.bib/webapp)

Port from `apps/run.human/webapp/`:
- **Deps to add:** `@heroui/react`, `@heroui/theme`, `next-themes`, `framer-motion`, `react-icons`, `clsx`.
- **Tailwind + CSS:** port `tailwind.config.js` (HeroUI plugin, teal `#00d4aa` palette, keyframes) and
  create a real `src/styles/globals.css` entry (`@import "tailwindcss"; @config "../../tailwind.config.js";`
  + `.glass-nav`, `.glass-card`, `.teal-dot`, `.nav-active`, `.noise-overlay`). NOTE: bib has Tailwind
  installed but **inert today** (no CSS entry imports it) — this fixes that.
- **Fonts:** port `src/config/fonts.ts` (Inter / Fira Code / MuseoModerno wordmark / Atkinson) and wire
  the `.variable`s onto `<body>`.
- **Providers:** rewrite `src/app/providers.tsx` → `HeroUIProvider` + `NextThemesProvider`
  (attribute:"class", defaultTheme:"dark"), KEEP the existing `SessionProvider`.
- **Header:** port `src/components/header/header.tsx` (+ `theme-switch.tsx`, user/login dropdown, icons).
  Nav links: Maps → `https://gpx.defcon.run`, Meshtastic → `https://run.defcon.run/meshtastic`; the bib
  app itself is "Bib" (active). Adapt the user dropdown to bib's Auth.js OIDC session
  (`session.user` shape). Version tooltip → bib VERSION.
- **Footer:** port `src/components/footer.tsx`.
- **Parallax:** port `src/components/map-background.tsx` + copy `public/bg/vegas-z9..z12.png` assets into
  `run.bib/webapp/public/bg/`. The `getApiBasePath()` helper ports cleanly (bib uses the same
  `basePath: /${REGION_SHORT}` convention).
- **Layout:** recompose `src/app/layout.tsx` → `<MapBackground/>` (z-0) → `.noise-overlay` wrapper →
  `<Header/>` / `<main className="relative z-10">` / `<Footer/>`.

**Risk:** the ported header's user-dropdown depends on session shape; needs adaptation to bib's OIDC
session. The forms get rewritten (A2–A7). Mitigation: all work on the isolated branch; verify
`next build` + `tsc` + `vitest` + the Stripe-test + name-save flows before any deploy; live v0.0.18
keeps serving meanwhile.

### A2. One header (#2)
Remove the duplicated "Get Your Bib" (page H1) + "Get your bib" (Section H2). With the site Navbar on
top, the page gets a **single** title: **"run.defcon.run 34 · Bib"**. Drop the redundant Section H2.

### A3. Name-first (#3)
Move the "Name on bib" input **above** the `<BibPreview/>` (currently preview-then-input). It's the
first interactive control; the preview updates live below it.

### A4. Hide "pay in person" once transacted (#4)
`WillPayInPersonCheckbox` renders only when the user has NOT transacted money toward the bib
(`hasTransacted = paidAmount > 0 || donationTotal > 0`). Once they've paid, hide it entirely.

### A5. Subtle rename quota (#5)
Hide the "N name changes left" count normally. Show a subtle hint **only when `renamesRemaining ≤ 3`**
(e.g. small muted "3 name changes left"). Drives off the existing `renamesRemaining` value.

### A6. Donation box alignment (#6)
Fix the inner `SponsorForm` card bleeding **outside** its parent tile (screenshot). Rebuild the tile +
form with HeroUI `Card` + correct `box-sizing`/width so the form sits fully within the parent; tighten
padding/margins.

### A7. Slider + editable amount (#7)
Consolidate the amount UI into one row: `[ slider ————————— [$ amount] ]`. The editable amount box
sits at the **right end** of the slider, mirrors the slider value, is **overtypable** to any value
($10–$1000), and moving the slider repositions the box (and vice-versa). Replaces the current
big-number-display + separate "type an exact amount" input. HeroUI `Slider` + `Input`. Keep the
$20 bib-min / $10 general-min contract; slider ceiling $200, free-type up to $1000.

---

## Phase B — Admin Reporting Dashboard (#9)

### B1. Admin gate → group claim
Rewrite `src/lib/admin-gate.ts`: `requireAdmin(session)` gates on
`session.user.services?.includes("admin")` (drop SSM allowlist / `getSecureParam` / cache). Mirror
run.human `isAdmin()`. Reuse the `RequireAdminResult` union (rename `not_allowlisted` → `not_admin`).
Update `__tests__/admin-gate.test.ts` accordingly. Existing `pledged-unpaid/route.ts` call site keeps
working unchanged. No OIDC/config change (services already flows to the session).

### B2. `/admin` dashboard page
New gated `src/app/admin/page.tsx` (server component): `auth()` → `requireAdmin` → 403 UI if not admin.
Reads entities in-process (like `orderform` does). Four report tables, each with a CSV download button.
Reuse the aggregation logic shape from `scripts/bib-report.sh`.

**Reports:**
1. **Print-name list** — bibs with `paidAmount ≥ 1000` (≥$10 print gate) OR `nameLocked`: columns
   nameOnBib, runnerCode, paidAmount, nameLocked. The printer handoff.
2. **Payments / revenue** — reconciled money: per-user `paidAmount` + `paidStatusHistory`
   (provider/amount/timestamp) + `GeneralDonation` rows; provider breakdown + grand total.
3. **Outstanding + in-person** — pledged-unpaid (`willPayInPerson && paidAmount==0`) + unreconciled
   `PendingContribution` / `BibReconcile` (status ≠ matched).
4. **All registrations** — master roster: nameOnBib, runnerCode, paidAmount, willPayInPerson, createdAt.

### B3. CSV endpoints
`GET /api/admin/bib/report/{type}` (type ∈ print-names|payments|outstanding|registrations) → `text/csv`,
gated by the same `requireAdmin`. Streams the report as CSV for the print/finance handoff.

**Scale note:** scans are O(n) over the electro table but row count is bounded (single thousands at
DEF CON 34 attendance) — fine at v1.5/1.6. A `byWillPayInPerson`/`byPaidGate` GSI is a v1.7+ option if
latency bites.

---

## Verification plan

- `tsc --noEmit`, `eslint`, `vitest run` green after each phase.
- `next build` clean (10+ routes).
- Local run (`next dev -p 3004`) against local DynamoDB (`RUN_ELECTRO_ENDPOINT=http://localhost:8000`,
  `apps/local/dynamodb` docker + `set-user-services.sh` to grant a local admin) OR prod-read for the
  dashboard. Visual check: parallax renders, header wordmark + nav match run.human, teal palette,
  name-first, slider+amount, donation box contained, admin dashboard tables + CSV.
- Stripe **test-mode** sponsor + donate still complete end-to-end (regression guard).
- No deploy without Kurt's review (bib is live at v0.0.18).

## Out of scope / deferred
- Real Stripe live-mode + real Venmo/CashApp receipt round-trip (HITL for Kurt post-merge).
- Anonymous general-donation flow; Venmo/CashApp general matcher fallback (v1.5 carryovers).
- Jesse admin grant (do when his OIDC sub is known).
- Multi-region parity for any new infra (dashboard is app-only, no new infra).
