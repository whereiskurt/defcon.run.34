---
phase: 34-bib-admin-orderform
verified: 2026-07-04T21:10:00Z
status: human_needed
score: 7/10 must-haves verified
behavior_unverified: 3
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC34.2 — An admin can reconcile a pending Venmo/Cash App intent inline with an editable amount; the ledger applies and the dashboard refreshes (WR-01: re-approving an edited amount is a dedup no-op that must surface 'already reconciled')"
    test: "On /admin, approve a real pending-intent row (edit the cents field), then re-approve the same row with a different amount."
    expected: "First approve books the payment/donation and router.refresh() shows it moved out of Outstanding; second approve returns deduped and AdminActions shows 'Already reconciled — amount unchanged.' Only the reconciled pending row is cleared — a second same-provider intent for a different amount survives on the dashboard."
    why_human: "Live money-ledger state transition + cross-service quota hop + DynamoDB mutation. The primitives (applyPayment idempotency, recordDonation, requireAdmin, clearPendingById) are unit-tested, but no test exercises the route composition or the WR-01 dedup response end-to-end."
  - truth: "SC34.3 — An admin can reject/reset a runner's bib inline behind a confirm; the bib + owner's pending intents are deleted, the bibname_change quota is restored to full, donations survive, and the dashboard refreshes"
    test: "On /admin, Reject a registered bib that has a consumed name-change quota and at least one donation. Confirm the dialog."
    expected: "Bib row disappears after router.refresh(); the runner's pending intents are cleared; their bibname_change quota reads full again; the GeneralDonation ledger row is untouched; revisiting the site auto-creates a clean bib."
    why_human: "Live delete + cross-service quota restore is a multi-entity state transition; donation-survival and quota-restore-to-full cannot be observed by presence/grep, and the route composition is not integration-tested."
  - truth: "SC34.4 — The '$20 in person' checkbox renders BETWEEN Sponsor and Donate on mobile and FULL-WIDTH BELOW both on desktop; checking it hides the Sponsor tile and rains cash over the bib preview (WR-02: a paid+pledged bib must load with no perpetual rain)"
    test: "Load /orderform at a narrow (<640px) and a wide viewport. Toggle the checkbox. Then load as a runner who pledged in-person AND later paid online."
    expected: "Mobile: checkbox sits between the two tiles; desktop: full-width below both. Checking hides the Sponsor tile and cash rains over the preview. The paid+pledged runner loads with the checkbox hidden and NO rain stuck on."
    why_human: "Responsive reflow (Tailwind order utilities) and the cash-rain animation are visual; the WR-02 seed-gating fix must be confirmed by eyeball in the running app across viewports."
human_verification:
  - test: "Admin reconcile walkthrough (SC34.2) — approve a pending intent with an edited amount, then re-approve with a changed amount."
    expected: "First approve books the amount and refreshes the dashboard; re-approve surfaces 'Already reconciled — amount unchanged'; a second same-provider intent for a different amount is NOT wiped."
    why_human: "Live money-ledger mutation + WR-01 dedup response not integration-tested."
  - test: "Admin reject walkthrough (SC34.3) — reject a bib with consumed quota + a donation."
    expected: "Bib + pending intents deleted, bibname_change quota restored to full, donation preserved, dashboard refreshes."
    why_human: "Live multi-entity delete + cross-service quota restore; donation-survival not integration-tested."
  - test: "Responsive checkbox reflow + cash-rain + WR-02 (SC34.4) at mobile and desktop widths."
    expected: "Checkbox between tiles on mobile, full-width below on desktop; checking hides Sponsor + rains cash; paid+pledged bib loads with no perpetual rain."
    why_human: "Visual responsive layout + animation; WR-02 seed-gating needs eyeball."
  - test: "Save-button glow (SC34.5 visual) — type an unsaved name."
    expected: "Save button gains the mint glow ring + enlarges (pulse animation, gated for reduced-motion). The UNSAVED stamp priority is already unit-verified."
    why_human: "Glow appearance/animation is visual polish."
  - test: "ALTCHA blur overlay (SC34.7 visual) — trigger a name save, a checkbox toggle, and a Sponsor/Donate checkout."
    expected: "A once-mounted full-viewport dimmed+blurred layer with a centered 'Checking you're human…' spinner appears during each PoW and auto-dismisses when the last solve resolves. No inline 'verifying' text remains."
    why_human: "Overlay rendering + auto-dismiss timing is visual; the store increment/decrement is already unit-tested."
  - test: "Social-QR live render + cross-app hop + print (SC34.8) — open /orderform as a runner with a run.human hash, and as one without."
    expected: "Tear-off stubs render the runner's real /r?h=<hash> QR enlarged and crisp; scanning resolves to the SAME target as the run.human profile 'Show My QR'. A runner with no hash falls back to the runner-code QR — never a blank stub."
    why_human: "Live cross-service fetch (run.bib → run.human internal endpoint) + physical print crispness are runtime/visual; the URL builder + null-safe fallback selection are unit-tested."
  - test: "run.human build + per-slice running-app check (SC34.9)."
    expected: "apps/run.human/webapp still builds after the additive `hash` field; each of the three slices behaves as specced in the running app before the phase closes."
    why_human: "Roadmap SC34.9 explicitly requires each slice verified in the running app; run.human build was not re-run in this verification."
---

# Phase 34: Bib Admin, Orderform UX & Social QR — Verification Report

**Phase Goal:** Make the run.bib admin dashboard truthful and actionable (filter phantom registrations; inline reconcile of pending Venmo/Cash App intents; inline reject/reset of a runner's bib), make the orderform's save/pledge UX unmistakable (responsive checkbox placement, loud unsaved state, hardened implicit save, ALTCHA blur overlay), and print the runner's real social QR on the bib tear-offs with a runner-code fallback.

**Verified:** 2026-07-04T21:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification (post-fix HEAD b42cb458, fixes fd447a28..b749c5c7 verified against current code)

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 (SC34.1) | Empty visit-created bibs excluded from `totals.bibs` + roster; named/paid/pledged kept | ✓ VERIFIED | `admin-reports.ts:144` `isRegistered()`; `buildReports` filters `registered` for roster + `totals.bibs = registered.length` (L163,259,276); `admin-reports.test.ts` has 19 phantom-bib fixture refs; full-list still drives print/payments/pledges |
| 2 (SC34.2) | Admin reconciles a pending intent inline (editable amount), dashboard refreshes; idempotent per-kind | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Route present + `requireAdmin` first (`reconcile/route.ts:47`), per-kind idempotency + WR-01 `deduped` + IN-03 `.max(10_000_00)` + `skipPendingClear`/`clearPendingById`; `AdminActions.ReconcileAction` wired into pending-intent rows (`admin/page.tsx:138`) with `router.refresh()`. Primitives unit-tested (apply-payment, admin-gate, general-donation, pending-contribution) but live mutation + dedup path not integration-tested |
| 3 (SC34.3) | Admin rejects/resets a bib inline (confirm), deletes bib+pending+restores quota, donations survive, refresh | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Route present + `requireAdmin` (`reject/route.ts:39`), `Bib.delete` + `clearPendingForOwner` (both kinds×providers) + isolated `restoreQuota` try/catch; donations never touched; `RejectAction` confirm + `router.refresh()` wired (`admin/page.tsx:168`). Live delete + quota-restore not integration-tested |
| 4 (SC34.4) | Checkbox between tiles on mobile / full-width below on desktop; hides Sponsor; rains cash | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `orderform/page.tsx:267` `grid gap-5 sm:grid-cols-2`, checkbox `order-2 sm:order-3 sm:col-span-2`; `hideBuyBib` present; rain bridge: `WillPayInPersonCheckbox.setRaining` → `rain-store` → `BibForm` subscribe → `CashRain`; WR-02 fix `initialRaining = showCheckbox && willPayInitial` (L172). Responsive reflow + animation are visual |
| 5 (SC34.5) | Dirty name → Save glow+enlarge + UNSAVED stamp; UNSAVED outranks PAID | ✓ VERIFIED | `BibPreview.tsx:332` `dirty ? UNSAVED : (hasSponsored && PAID)`; `bib-preview.test.tsx:53` asserts UNSAVED renders + suppresses PAID while dirty, PAID restored when clean; glow via `.bib-save-dirty` (`globals.css:148`, reduced-motion gated) + enlarged padding/font in `BibForm.tsx:239` |
| 6 (SC34.6) | Clicking Sponsor/Donate commits the name before checkout, both variants | ✓ VERIFIED | `SponsorForm.performSponsorCheckout` awaits `flush()` before fetch/navigate/redirect (L169); `sponsor-form.test.ts:144` ordering-invariant tests assert `["flush","fetch","redirect"]` for bib + general + Venmo handoff + error path (microtask-yield catches a non-awaited race); `registerBibFlusher` wired in `BibForm.tsx:163` |
| 7 (SC34.7) | ALTCHA PoW shows once-mounted blur overlay spinner, auto-dismiss on counter→0; inline text removed; store unit-tested | ✓ VERIFIED | `altcha-overlay.ts` begin/end/subscribe (count floored at 0); `altcha-overlay.test.ts` tests 0→1/1→0 + nested + over-drain floor; `solveAltcha` begin()/end() in finally (`altcha-client.ts:29,61`); `AltchaOverlay` mounted in `providers.tsx:40` inside HeroUIProvider; SaveStateHint verifying branch removed (`BibForm.tsx:321`) |
| 8 (SC34.8) | run.human endpoint returns `hash`; run.bib builds `/r?h=<hash>`; enlarged QR on stubs; runner-code fallback | ✓ VERIFIED | `run.human .../route.ts:85` adds `hash: user.hash` (seed/rsapriv NOT exposed); `social-qr.ts` `getSocialQrHash` null-safe + `buildSocialQrUrl` IN-04 `encodeURIComponent`; `social-qr.test.ts` pins exact `/r?h=` shape + null fallback; `BibPreview` `stubQrValue = socialQrUrl || runnerCode`, `QrBadge size={112}` vector; threaded page→GetYourBib→BibForm→BibPreview. Live cross-app hop + print crispness are human |
| 9 (SC34.9) | `next build` + vitest pass (run.bib); run.human still builds; each slice verified in running app | ✓ VERIFIED (automated gate) | vitest **180/180 pass** (19 files), `tsc --noEmit` exit 0 (both re-run in this verification); `next build` green post-fix per phase notes. Running-app per-slice verification → human items below |
| 10 (BIB-ADM-10) | Bib user menu mirrors flash/run.human (7 keys); cross-app links region-prefixed via `runHumanUrl`; cms/admin gating | ✓ VERIFIED | `user-dropdown.test.ts:25` asserts 7 keys in order + `runHumanUrl` for whoami/checkin/qr + new-tab + cms/admin `services` gating + in-app /admin,/orderform; `runHumanUrl` reads `NEXT_PUBLIC_REGION_SHORT` at call time; header + menu-dropdown Meshtastic via `runHumanUrl`; IN-01/IN-02 noopener fixes present |

**Score:** 7/10 truths verified (3 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/admin-reports.ts` | exports `isRegistered`, filtered totals/roster | ✓ VERIFIED | Present, substantive, wired (loadReports→admin page), unit-tested |
| `src/app/api/admin/bib/reconcile/route.ts` | admin-gated reconcile | ✓ VERIFIED | Present + wired to AdminActions; WR-01/IN-03 fixes in place |
| `src/app/api/admin/bib/reject/route.ts` | admin-gated reject | ✓ VERIFIED | Present + wired to RejectAction |
| `src/components/AdminActions.tsx` | ReconcileAction + RejectAction | ✓ VERIFIED | Both exported + wired into admin/page.tsx tables with refresh |
| `src/lib/social-qr.ts` | getSocialQrHash + buildSocialQrUrl | ✓ VERIFIED | Present, null-safe, unit-tested; IN-04 encode fix |
| `src/lib/altcha-overlay.ts` | begin/end/subscribe/useAltchaBusy | ✓ VERIFIED | Present, floored counter, unit-tested |
| `src/components/AltchaOverlay.tsx` | blur overlay spinner | ✓ VERIFIED | Present, mounted once in providers.tsx |
| `src/lib/rain-store.ts` | setRaining/subscribe | ✓ VERIFIED | Present, wired checkbox→BibForm |
| `src/components/BibPreview.tsx` | dirty + socialQrUrl props | ✓ VERIFIED | UNSAVED stamp + enlarged QR + fallback |
| `src/lib/run-human-url.ts` | region-prefix helper | ✓ VERIFIED | Present, call-time env read, unit-tested |
| `src/components/user-dropdown.tsx` | 7-key flash-parity menu | ✓ VERIFIED | Present, unit-tested source contract |
| `run.human .../internal/user/[oidcSub]/route.ts` | additive `hash` | ✓ VERIFIED | `hash: user.hash` added; secrets not exposed |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| admin-reports pending-intent row | ReconcileAction | pendingId+ownerSub+kind carried on OutstandingRow → admin/page.tsx:138 | ✓ WIRED |
| admin-reports RegistrationRow | RejectAction | ownerSub carried → admin/page.tsx:168 | ✓ WIRED |
| reject route | quota-client restoreQuota | getUserQuotas → restoreQuota(ownerSub,'bibname_change',totalConsumed) | ✓ WIRED |
| WillPayInPersonCheckbox | CashRain | setRaining → rain-store → BibForm subscribe → CashRain active | ✓ WIRED |
| BibForm dirty | BibPreview UNSAVED | dirty prop → stamp priority over PAID | ✓ WIRED |
| SponsorForm | flushPendingBibName | performSponsorCheckout awaits flush before checkout (both variants) | ✓ WIRED |
| solveAltcha | AltchaOverlay | begin()/end() finally → store → overlay in providers.tsx | ✓ WIRED |
| orderform page | BibPreview socialQrUrl | getSocialQrHash+buildSocialQrUrl → GetYourBib → BibForm → BibPreview | ✓ WIRED |
| run.human hash | run.bib getSocialQrHash | internal endpoint JSON `hash` → X-Internal-Secret fetch | ✓ WIRED |
| runHumanUrl | header/menu/dropdown | region-prefixed cross-app links | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full vitest suite (run.bib) | `npx vitest run` | 180 passed / 19 files | ✓ PASS |
| Typecheck (run.bib) | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| SC34.1 phantom-bib filter | `admin-reports.test.ts` (in suite) | pass | ✓ PASS |
| SC34.5 UNSAVED outranks PAID | `bib-preview.test.tsx:53` (in suite) | pass | ✓ PASS |
| SC34.6 flush-before-checkout ordering | `sponsor-form.test.ts:144` (in suite) | pass | ✓ PASS |
| SC34.7 overlay counter increment/decrement/floor | `altcha-overlay.test.ts` (in suite) | pass | ✓ PASS |
| SC34.8 buildSocialQrUrl shape + null fallback | `social-qr.test.ts` (in suite) | pass | ✓ PASS |
| BIB-ADM-10 menu contract | `user-dropdown.test.ts` (in suite) | pass | ✓ PASS |
| Admin reconcile/reject live flow | — | needs running app + DynamoDB | ? SKIP → human |
| run.human build after endpoint change | — | not re-run (per phase notes) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| BIB-ADM-01 (registration filter) | 34-01 | ✓ SATISFIED | isRegistered + filtered totals/roster, unit-tested |
| BIB-ADM-02 (reconcile) | 34-01 | ? NEEDS HUMAN | Code present+wired; live money flow → human |
| BIB-ADM-03 (reject) | 34-01 | ? NEEDS HUMAN | Code present+wired; live delete/quota → human |
| BIB-ADM-04 (responsive checkbox) | 34-03 | ? NEEDS HUMAN | Tailwind classes present; visual reflow → human |
| BIB-ADM-05 (loud unsaved state) | 34-03 | ✓ SATISFIED | UNSAVED stamp unit-tested; glow present (visual polish → human) |
| BIB-ADM-06 (implicit save) | 34-03 | ✓ SATISFIED | Ordering-invariant test passes |
| BIB-ADM-07 (ALTCHA overlay) | 34-04 | ✓ SATISFIED | Store unit-tested; overlay mounted+wired (visual → human) |
| BIB-ADM-08 (social QR) | 34-02/04 | ✓ SATISFIED | Endpoint+builder+fallback tested (live hop/print → human) |
| BIB-ADM-09 (quality gate) | all | ✓ SATISFIED | vitest 180/180, tsc clean |
| BIB-ADM-10 (menu alignment) | 34-05 | ✓ SATISFIED | user-dropdown contract tested |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| BibPreview.tsx | 47,71,128,142,161 | grep hit on `XXX`/`PLACEHOLDER` | ℹ️ Info | False positives — `BIB-XXXX` example text and `PRIMARY_PLACEHOLDER` const name (the "1337" bib placeholder). No unresolved debt markers. |

No `TODO`/`FIXME`/`HACK`/`TBD` debt markers in any phase-modified file. All 6 code-review findings (WR-01, WR-02, IN-01…04) verified fixed against current HEAD.

### Post-Fix Regression Check

The WR-01 (reconcile dedup surfacing) and WR-02 (cash-rain seed gating) fixes landed AFTER the plan summaries. Verified against current code, not summary claims:
- WR-01: `reconcile/route.ts` returns `{ ok, deduped }`; `AdminActions` surfaces "Already reconciled — amount unchanged"; `skipPendingClear` + targeted `clearPendingById` preserve other intents. No regression — reconcile tests' primitives (apply-payment, general-donation) still pass.
- WR-02: `orderform/page.tsx:172` `initialRaining = showCheckbox && willPayInitial`, threaded into GetYourBib. No regression — will-pay-in-person + bib-preview suites pass.
- Full suite 180/180 + tsc clean confirm no plan-truth regressed.

### Human Verification Required

7 items (see frontmatter `human_verification`). The three ⚠️ PRESENT_BEHAVIOR_UNVERIFIED truths (SC34.2 reconcile, SC34.3 reject, SC34.4 responsive/rain) plus the visual/print/live-hop confirmations for SC34.5 glow, SC34.7 overlay, SC34.8 QR, and SC34.9's mandated running-app per-slice check. All map to the roadmap's SC34.9 "each slice verified in the running app before the phase closes."

### Gaps Summary

No gaps. No FAILED truths, no missing/stub artifacts, no unwired links, no blocker anti-patterns. Every artifact exists, is substantive, is wired, and (for dynamic renders) flows real data. The full vitest suite (180/180) and typecheck pass. Six code-review findings are fixed and verified against current HEAD.

The phase is code-complete and unit-verified. Status is `human_needed` (not `passed`) solely because roadmap SC34.9 mandates each slice be verified in the running app, and three truths — the two admin money/quota state transitions (SC34.2/34.3) and the responsive/cash-rain visual behavior (SC34.4) — are present + wired with tested primitives but whose runtime state transitions and visual reflow are not exercised by any automated test. These are eyeball/integration confirmations, not defects.

---

_Verified: 2026-07-04T21:10:00Z_
_Verifier: Claude (gsd-verifier)_
