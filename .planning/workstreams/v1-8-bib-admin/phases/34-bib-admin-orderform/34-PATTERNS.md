# Phase 34: Patterns & Reuse Map

Map each new/changed artifact to the closest existing analog so the build follows
house style. All paths under `apps/run.bib/webapp/src` unless noted.

## New files → closest analog

| New file | Analog to copy the shape from | Notes |
|----------|-------------------------------|-------|
| `app/api/admin/bib/reconcile/route.ts` | `app/api/bib/route.ts` (auth + zod + error mapping) and `app/api/admin/bib/report/[type]/route.ts` (admin gate) | `requireAdmin(await auth())`; `runtime="nodejs"`; zod `safeParse` → 400; reuse `applyPayment`/`recordDonation`/`clearPendingForOwner`. |
| `app/api/admin/bib/reject/route.ts` | same as above | `Bib.delete({ownerSub})`; quota reset via `lib/quota-client.ts` `getUserQuotas`+`restoreQuota`. |
| `components/AdminActions.tsx` (`ReconcileAction`, `RejectAction`) | `components/WillPayInPersonCheckbox.tsx` (client fetch + `useRouter().refresh()` + save-state) | `"use client"`; optimistic-ish; `router.refresh()` on success; `apiBase()` prefix like `admin/page.tsx`. |
| `lib/rain-store.ts` | `lib/pending-bib-save.ts` (module singleton + register/subscribe) | Tiny store: `setRaining`/`subscribe`. |
| `lib/altcha-overlay.ts` | `lib/pending-bib-save.ts` (module singleton) | In-flight counter `begin`/`end`/`subscribe`. |
| `components/AltchaOverlay.tsx` | `components/CashRain.tsx` (fixed overlay client component) + HeroUI `Spinner` | Mounted once in `app/providers.tsx`; `backdrop-filter: blur`. |
| `lib/social-qr.ts` | `lib/quota-client.ts` (internal URL + `X-Internal-Secret` fetch) | `getSocialQrHash(ownerSub)` + `buildSocialQrUrl(hash)`; catch→null. |

## Changed files → what to preserve

| File | Change | Preserve |
|------|--------|----------|
| `lib/admin-reports.ts` | add+export `isRegistered`; filter `totals.bibs` + `registrations`; carry `pendingId`+`ownerSub` on pending-intent `OutstandingRow`s and `ownerSub` on `RegistrationRow` | Keep `buildReports` pure (AWS-free) so vitest stays valid; keep cents-int discipline + `formatUsd`. |
| `app/admin/page.tsx` | render `ReconcileAction`/`RejectAction`; consume new row fields | Server component; plain dark-theme; `apiBase()` prefix. |
| `app/orderform/page.tsx` | move checkbox to tiles region (Tailwind responsive); compute + thread `socialQrUrl` | Keep the server-component bootstrap (`getBib`/`createBib`), `hideBuyBib`, big THANK YOU logic. |
| `components/GetYourBib.tsx` | drop `raining` useState + `showCheckbox`; subscribe rain via `rain-store` | Stays the client wrapper around `BibForm`. |
| `components/WillPayInPersonCheckbox.tsx` | `onCheckedChange`→`rain-store.setRaining`; PoW hint covered by overlay | Keep debounce + ALTCHA PATCH + `router.refresh()`. |
| `components/BibForm.tsx` | glow/enlarge Save when `dirty`; pass `dirty` to preview; subscribe rain; drop "verifying" hint | Keep explicit Save/Cancel, quota handling, `registerBibFlusher`. |
| `components/BibPreview.tsx` | add `dirty` + `socialQrUrl` props; UNSAVED stamp (outranks PAID); enlarge QR + reposition stubs | Keep the auto-shrink `fitFontSize`, the SVG structure, vector `QrBadge`. |
| `components/SponsorForm.tsx` | verify `flushPendingBibName` await path (both variants) | Keep slider/custom/provider logic + checkout endpoints. |
| `lib/altcha-client.ts` | wrap PoW with overlay `begin`/`end` (finally) | Keep `solveAltcha` return contract + `AltchaLevel`. |
| `app/providers.tsx` | mount `<AltchaOverlay/>` inside `HeroUIProvider` | Keep NextThemes/HeroUI/Session/SilentSSO nesting + basePath handling. |
| `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` | add `hash: user.hash` to the JSON | Do NOT expose `seed`/`rsaprivSHA`; keep the admin/internal gate + existing fields. |

## Key reuse facts (verified 2026-07-04)

- Admin gate: `lib/admin-gate.ts` `requireAdmin(session)` → `{ok, email}` | `{ok:false, reason}`. Group claim = `session.user.services.includes("admin")`.
- Payments: `entities/bib.ts` `applyPayment(ownerSub, {provider, amount_cents, reconciled_via, timestamp?})` — idempotent by `reconciled_via`; auto-clears venmo/cashapp pending.
- Donations: `entities/general-donation.ts` — `recordDonation(...)` + `stripeSessionDonationId`; use a manual reconciled id for admin-reconciled donations.
- Pending: `entities/pending-contribution.ts` — `listPendingForOwner`, `clearPendingForOwner(ownerSub, kind, provider)`.
- Quota: `lib/quota-client.ts` — `getUserQuotas` returns `quotas[].{remaining, initialAmount, totalConsumed}`; `restoreQuota(userId, quotaId, amount)` adds back. No hard reset endpoint (run.auth exposes only `restore`). Reset = restore `totalConsumed`.
- Social QR value: run.human `entities/run-user.ts` builds `eqr` from `https://run.<domain>/<region>/r?h=<hash>`; `hash = sha256(rsapubSHA+seed)`, random, stored on `RunUser` (`run-human-electro` table, also read by run.bib). NOT derivable from session claims.
- Print gate stays `canPrintName` (paid ≥ $20 AND name) — unchanged by this phase.
