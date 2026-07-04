# Phase 34: Bib Admin, Orderform UX & Social QR — Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Source:** `docs/superpowers/specs/2026-07-04-bib-admin-and-orderform-design.md` + `.planning/workstreams/v1-8-bib-admin/{DESIGN,ROADMAP}.md`
**Workstream:** v1-8-bib-admin (single combined phase — Kurt's choice 2026-07-04)

<domain>
## Phase Boundary

Three slices delivered together on `apps/run.bib` (+ one additive `apps/run.human`
change):
- **A. Admin** — the `/admin` dashboard stops counting empty visit-created bibs, and
  gains two inline organizer actions: reconcile a pending Venmo/Cash App payment, and
  reject/reset a runner's bib.
- **B. Orderform UX** — responsive placement of the in-person checkbox, an unmistakable
  "unsaved" state, reliable implicit save on Sponsor/Donate, and a blur-overlay spinner
  during the ALTCHA proof-of-work.
- **C. Social QR** — the bib tear-off QR encodes the runner's real per-user social-QR
  value (run.human profile "Show My QR"), enlarged, with a runner-code fallback.

**In scope:**
- `apps/run.bib/webapp` — admin dashboard + API, orderform + components, libs.
- `apps/run.human/webapp` — ONE additive change: internal user endpoint returns `hash`.

**Explicitly out of scope (deferred):**
- Matching un-owned inbound receipt emails (`BibReconcile`) to runners in the admin UI.
- A hard quota "reset" endpoint in run.auth (reuse `restore`).
- Re-skinning `/admin` to the HeroUI/Vegas design system (stays plain dark-theme).
</domain>

<decisions>
## Implementation Decisions (Kurt 2026-07-04, all locked)

1. **Registration definition** — a bib counts only when it has a name, a payment, OR an
   in-person pledge (`isRegistered`). Keep auto-create-on-visit; filter empties from
   admin totals + roster only.
2. **Reconcile scope** — pending intents (`PendingContribution`, owned rows) ONLY.
3. **Reconcile amount** — admin-editable, prefilled from the intent's `amountCents`.
4. **Reject bib** — delete the bib + that owner's pending intents + reset
   `bibname_change` quota to full; KEEP donations. Revisiting auto-creates a clean bib.
5. **Checkbox interaction** — checking "$20 in person" STILL hides the Sponsor tile
   (`hideBuyBib`), unchanged.
6. **Checkbox placement** — responsive: BETWEEN Sponsor & Donate on mobile, FULL-WIDTH
   BELOW both on desktop. Needs Tailwind breakpoints (inline styles can't express them).
7. **Unsaved state** — dirty name → Save button glows + enlarges, AND an "UNSAVED" stamp
   on the bib preview in the same slot as `PAID! THANK YOU!`. UNSAVED outranks PAID
   while dirty.
8. **Implicit save** — clicking Sponsor/Donate commits the current name first (harden the
   existing `flushPendingBibName` bridge; both variants).
9. **ALTCHA overlay** — once-mounted HeroUI blur-overlay Spinner ("Checking you're
   human…") driven by an in-flight counter inside `solveAltcha`; remove inline
   "verifying" text.
10. **Social QR** — encode `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>` using
    run.human's `RunUser.hash` (via an extended internal endpoint); enlarge; fall back to
    the runner-code QR when no `hash`. Do NOT recompute the hash (needs run.human-only
    `seed`).
</decisions>

## Implementation Plan (task-level, per slice)

### Slice A — Admin reporting

**A-T1 · Filter empty bibs** — `src/lib/admin-reports.ts`
- Add + export `isRegistered(b: BibItem): boolean` = `(nameOnBib?.trim().length>0) || (paidAmount??0)>0 || willPayInPerson===true`.
- In `buildReports()`: filter the `registrations` roster by `isRegistered`; set
  `totals.bibs` to the count of registered bibs (NOT `bibs.length`). Leave `printNames`
  and `outstanding` (already name/pledge/pending-filtered).
- Update `src/__tests__` admin-reports vitest: add a fixture with an empty bib and assert
  it's excluded from `totals.bibs` + roster, and that named/paid/pledged bibs are kept.

**A-T2 · Reconcile route** — new `src/app/api/admin/bib/reconcile/route.ts`
- `export const runtime = "nodejs"`. `POST` only.
- `requireAdmin(await auth())` → 401 `no_session` / 403 `not_admin`.
- zod body: `{ pendingId: string, ownerSub: string, kind: "bib"|"donation", provider: "venmo"|"cashapp", amountCents: number(int,>0) }`.
- `kind==="bib"` → `applyPayment(ownerSub, { provider, amount_cents: amountCents, reconciled_via: \`admin_manual_${pendingId}\` })` (idempotent by `reconciled_via`).
- `kind==="donation"` → `recordDonation({ ownerSub, provider, amountCents, reconciled_via: \`admin_manual_${pendingId}\` })` (verify `recordDonation` signature in `entities/general-donation.ts` — it has `recordDonation` + `stripeSessionDonationId`; use a manual reconciled id).
- `clearPendingForOwner(ownerSub, kind, provider)` (defensive; applyPayment already does venmo/cashapp).
- Return `{ ok: true }` 200. Map errors → 500.

**A-T3 · Reject route** — new `src/app/api/admin/bib/reject/route.ts`
- `requireAdmin` gate. zod body `{ ownerSub: string }`.
- `Bib.delete({ ownerSub }).go()`.
- Pending cleanup: `clearPendingForOwner(ownerSub, "bib", "venmo"|"cashapp")` + same for
  "donation" — or `listPendingForOwner(ownerSub)` then delete each `pendingId`.
- Quota reset: `getUserQuotas(ownerSub)` → find `bibname_change` → if `totalConsumed>0`
  `restoreQuota(ownerSub, "bibname_change", totalConsumed)`. Wrap in try/catch (log +
  continue — a quota blip must not fail the delete).
- Donations untouched. Return `{ ok: true }` 200.

**A-T4 · Admin UI actions** — `src/app/admin/page.tsx` + new client component(s)
- `/admin` stays a server component. Add a client component file (e.g.
  `src/components/AdminActions.tsx`) exporting `ReconcileAction` (editable amount input
  prefilled from the row's `amountCents`, "Approve" button → `POST reconcile` → on ok
  `router.refresh()`) and `RejectAction` (button → `confirm()` → `POST reject` → on ok
  `router.refresh()`).
- Wire `ReconcileAction` into the Outstanding table's `source==="pending-intent"` rows
  (needs `pendingId`, `ownerSub`, `kind` — extend `OutstandingRow` / the pending mapping
  in `admin-reports.ts` to carry `pendingId` + `ownerSub` for these rows).
- Wire `RejectAction` into the "All registrations" roster rows (needs `ownerSub` — extend
  `RegistrationRow` to carry it). NOTE: `ownerSub` is the Bib PK; safe to expose to an
  admin-only page. Use `apiBase()` prefix on the fetch URLs (prod basePath).

### Slice B — Orderform UX

**B-T1 · Responsive checkbox + cash-rain bridge**
- `src/app/orderform/page.tsx`: stop passing the checkbox through `GetYourBib`
  (`showCheckbox`); instead render `WillPayInPersonCheckbox` in the tiles region.
  Layout with Tailwind: a container `grid gap-5 sm:grid-cols-2`; DOM order
  `Sponsor → checkbox → Donate`; checkbox `order-2 sm:order-3 sm:col-span-2` so it sits
  between on mobile and full-width below on desktop. Keep `hideBuyBib` (checked hides
  Sponsor). (These tiles currently use inline styles + a raw grid — migrate just this
  wrapper to Tailwind classes; tiles themselves can keep inline styles.)
- Cash-rain bridge: the checkbox and the bib preview (in `GetYourBib`/`BibForm`) are no
  longer siblings. Add `src/lib/rain-store.ts` — a module singleton with
  `setRaining(bool)` + `subscribe(cb)` (mirror `pending-bib-save.ts`). `WillPayInPersonCheckbox.onCheckedChange`
  → `setRaining`; `BibForm` subscribes and passes `raining` to `<CashRain>`.
  `GetYourBib` loses its `raining` useState + `showCheckbox`.

**B-T2 · Loud unsaved state**
- `src/components/BibForm.tsx`: when `dirty`, style the Save button with a glow
  (box-shadow ring in `#6CCDB8`) + larger padding/font; revert when clean. Pass a new
  `dirty={dirty}` prop into `<BibPreview>`.
- `src/components/BibPreview.tsx`: add `dirty?: boolean` prop. Render an "UNSAVED" rotated
  rubber-stamp in the same `transform`/position as the existing `sponsor-charm` group
  (currently guarded by `hasSponsored`), styled amber/red. Priority: if `dirty` show
  UNSAVED (hide PAID); else if `hasSponsored` show PAID. (BibPreview is imported by the
  client BibForm, so it renders client-side — reactive to the `dirty` prop.)

**B-T3 · Implicit-save hardening** — `SponsorForm.tsx` / `pending-bib-save.ts` / `BibForm.tsx`
- Already wired: `BibForm` `registerBibFlusher(onSave)`, `SponsorForm.onSubmit` awaits
  `flushPendingBibName()`. Verify: (a) the flush awaits the ALTCHA+PATCH before the
  checkout redirect (it does — `await flushPendingBibName()` precedes the fetch/redirect);
  (b) fires for both `variant="bib"` and `"general"` (it's variant-agnostic — good);
  (c) the blur overlay (B-T4) covers the flush's PoW. Minimal change expected; mainly a
  verification task. If the flush should visibly report, surface via the overlay only.

**B-T4 · ALTCHA blur overlay**
- `src/lib/altcha-overlay.ts` — in-flight counter store: `begin()`/`end()` mutate a count,
  `subscribe(cb)`; export `useAltchaBusy()` hook (or a subscribe function).
- `src/lib/altcha-client.ts` — in `solveAltcha`, call `begin()` at entry and `end()` in a
  `finally` so every caller (BibForm save, checkbox toggle, checkout flush) drives the
  overlay. (Keep the returned solution contract unchanged.)
- New `src/components/AltchaOverlay.tsx` (client) — subscribes to the store; when busy,
  render a fixed full-viewport dimmed + `backdrop-filter: blur()` layer with a centered
  HeroUI `<Spinner label="Checking you're human…" />`. Non-dismissable; auto-hides at 0.
  Use `framer-motion` fade if desired (available). Mount once in
  `src/app/providers.tsx` (inside `HeroUIProvider`).
- Remove the `verifying` inline text: in `BibForm`'s `SaveStateHint` drop the "Checking
  you're human… (~5s)" branch (the overlay replaces it); in `WillPayInPersonCheckbox`
  the "Saving…" hint during PoW is covered by the overlay too. Keep saved/error/quota/
  rename-count states.

### Slice C — Social QR

**C-T1 · run.human endpoint** — `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts`
- The handler already `getRunUser(adapterUserId)`; the returned `NextResponse.json({...})`
  currently exposes only `userId,displayName,mqtt*`. Add `hash: user.hash` to that object.
  Do NOT expose `seed` / `rsaprivSHA`. Confirm run.human still builds.

**C-T2 · run.bib social-QR fetch lib** — new `apps/run.bib/webapp/src/lib/social-qr.ts`
- Mirror `quota-client.ts`'s internal-URL + `X-Internal-Secret` pattern (same
  `AUTH_INTERNAL_URL` / service-discovery base). `getSocialQrHash(ownerSub): Promise<string|null>`
  → GET the internal user endpoint, return `hash` or null (catch → null; a QR miss must
  never 500 the orderform). `buildSocialQrUrl(hash): string` →
  `https://run.${SITE_DOMAIN}/${REGION_SHORT}/r?h=${hash}` from run.bib's own env
  (`SITE_DOMAIN` default `defcon.run`, `REGION_SHORT` default `use1`).

**C-T3 · Thread the URL** — `src/app/orderform/page.tsx` → `GetYourBib` → `BibForm` → `BibPreview`
- In the server component, `const socialQrUrl = hash ? buildSocialQrUrl(hash) : null`
  (best-effort). Pass `socialQrUrl` down alongside `runnerCode`.

**C-T4 · Render enlarged social QR** — `src/components/BibPreview.tsx`
- Add `socialQrUrl?: string` prop. In the tear-off region, encode `socialQrUrl` via the
  existing `QrBadge` when present, else fall back to `runnerCode`. Enlarge the badge
  (~76→~112px) and reposition the two stubs' QR `x/y` so the larger badges render fully
  inside the stub area without overlapping the number boxes/smileys. Keep the `QrBadge`
  vector renderer (stays crisp for print).

## Success Criteria

SC34.1–SC34.9 — see `.planning/workstreams/v1-8-bib-admin/ROADMAP.md`.

## Gated / environment notes

- Reconcile/reject call the run.auth quota service (internal secret via
  `AUTH_INTERNAL_SECRET`). Local dev: quota service on `LOCAL_AUTH_PORT`. Server enforces
  on write regardless.
- Social-QR fetch depends on run.human's internal endpoint reachable via service
  discovery. Unit-test the URL builder + fallback selection; if the live cross-app hop
  isn't reachable in a fresh sandbox, record a blocker in STATE.md and ship the
  runner-code fallback (bib never renders a blank stub).

## Testing

- **vitest (run.bib):** `isRegistered` + filtered totals/roster; reconcile/reject route
  logic with mocked entities + quota client; ALTCHA overlay store increment/decrement;
  `buildSocialQrUrl` + fallback selection.
- **build:** `next build` green in `apps/run.bib/webapp`; `apps/run.human/webapp` still
  builds after the endpoint change. Use node v23.6.0 for tests (see memory).
- **manual (run the app):** responsive checkbox (mobile between / desktop below), unsaved
  glow+stamp, blur overlay on save/toggle/checkout, admin reconcile + reject with refresh,
  QR resolves to the same `/r?h=` target as the run.human profile QR.
