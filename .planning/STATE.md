---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: CTF Flag Types & Form Redesign
status: Milestone complete
stopped_at: Phase 39 context gathered
last_updated: "2026-07-15T11:00:00.000Z"
last_activity: 2026-07-15
last_activity_desc: Phase 54 Plan 04 complete (CtfForm design-A redesign + Static reward OTP-enrollment configurator + edit-page secret redaction; Points field removed) — Phase 54 DONE (4/4)
progress:
  total_phases: 25
  completed_phases: 13
  total_plans: 53
  completed_plans: 50
  percent: 50
current_phase: 54
current_phase_name: ctf-flag-types-slice-1b-frontend-admin-form-redesign-otp-enr
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-05)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation. Milestone v2.2 brings back the DC33 leaderboard-as-activity-table in run.human, shipped hidden behind the admin group until perfected.
**Current focus:** Phase 53 — ctf-flag-types-slice-1a-backend-answer-type-framework-rotati

## Current Position

Milestone v1.9 CMS-Driven UI Copy Catalog — ✅ SHIPPED & ARCHIVED 2026-07-06.
All 5 phases (35-39, 21 plans) complete + verified. Archives:
`.planning/milestones/v1.9-ROADMAP.md` + `v1.9-REQUIREMENTS.md`. ROADMAP.md collapsed;
REQUIREMENTS.md removed (a fresh one comes with the next milestone).
Next: run `/gsd-new-milestone` to define the next milestone.

## Deferred Items

Items acknowledged and deferred at the v1.9 milestone close on 2026-07-06 (all NON-v1.9 —
pre-existing debt from other milestones, surfaced by the global pre-close audit):

| Category | Item | Status |
|----------|------|--------|
| verification | Phase 18 (v1.4 Build-Time Firmware) | human_needed — hardware boot verification pending |
| verification | Phase 19 (v1.4 Deps + DCR34 Branding) | human_needed — live flash-path regression pending |
| verification | Phase 33 (OIDC Silent SSO) | human_needed |
| quick_task | 1-wizard-panel-consistency-uniform-image-b | incomplete (backlog) |
| quick_task | 2-auto-register-flashed-radios-from-run-fl | incomplete (backlog) |

v1.9-internal note: cross-region (cac1) copy convergence was N/A for the shipped topology —
only us-east-1 was deployed for the copy-migrated apps, so there was no second live region to
observe against. The per-region mechanism (master → Litestream worker → revalidate) is
identical and will hold when a 2nd region deploys. Not counted as debt.

Last activity: 2026-07-15 — Phase 53 complete

## Roadmap Summary (v1.9)

| Phase | Goal | Requirements |
|-------|------|--------------|
| 35. CMS Copy Catalog Foundation | `ui-string` type + `(key,locale)` uniqueness + API-token read + S3 export hook | COPY-01/02/03/04, FALL-01 |
| 36. Runtime Copy Toolkit | `loadCopy` + Next Data Cache + merged-map `t()` + `CopyProvider`/`useCopy` + cached fallback | TOOL-01/02/03/04/05, FALL-02/03/04 |
| 37. Bib Donate/Sponsor Proof Surface | Wire bib donate/sponsor copy end-to-end (the proof) | MIGR-01 |
| 38. Custom Copy Admin Plugin | Three-column `label·locale·value` admin page + namespace filter + bulk upsert | ADMN-01/02/03 |
| 39. Copy Migration — Remaining Bib + Shared Chrome | Remaining bib copy + shared `common.*` chrome keys | MIGR-02/03 |

Deferred to v2: MIGR-04 (flash/human/auth/gpx migration), I18N-01 (locale population + switcher).

## Accumulated Context

### Roadmap Evolution

- Phase 54 added: CTF Flag Types — Slice 1b Frontend (Admin Form Redesign + otp-enroll QR/Rolling-Code Reward Renderer)
- Phase 55 added: CTF Flag Types — Slice 2 Scoring Windows (Day/Time/TZ Gating + DEF CON Run-Hours Quick Set)
- Phase 56 added: CTF Flag Types — Slice 3 Wordlist One-Time Codes (CtfCode Entity + Atomic Single-Use Claim)
- v2.3 milestone now fully sliced into phases 53 (done) → 54 → 55 → 56; autonomous execution of 54–56 authorized 2026-07-15

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.9]: Words-only scope — each app keeps its own React header/menu and reads labels by shared `common.*` key; no shared component library
- [v1.9]: No Redis / no revalidation webhook — eventual consistency (~15 min) rides the existing master/worker + Litestream topology + time-based `revalidate:N`
- [v1.9]: Model our own `locale` column (not native Strapi i18n plugin) for the three-column admin grid
- [v1.9]: Fallback must be cached — resolver (Strapi → S3 export → committed snapshot) is wrapped in the Next.js Data Cache so a destroyed CMS never costs a slow failed call per load
- [v1.9]: bib donate/sponsor is the proof surface — hardest case (client-side, interpolated, modal-heavy) validates the whole approach; the plane can land after Phase 37
- [v1.4]: Latest-stable firmware resolved at build time (not runtime) — preserves zero-runtime-dependency guarantee
- [v1.3]: NLB-only for mqtt.defcon.run (no CloudFront -- MQTT is raw TCP)
- [Phase ?]: Kept Strapi attribute name 'locale' despite Strapi reserving it (marked Private, dropped required/default); Plans 02/38 depend on the exact name so drive locale via the Plan 38 custom admin, not the default content-manager
- [Phase ?]: 35-02: (key,locale) uniqueness via lifecycle 4xx guard + idempotent DB unique-index backstop (Litestream-safe hasTable guard)
- [Phase ?]: 35-02: FALL-01 copy.json S3 export is master-only + S3-env-guarded, full-catalog regeneration on every create/update/delete; excludes notes
- [Phase 35]: 35-03: read-only API token auto-covers ui-string find/findOne (no grant widening); verified 200/200/403/403/403/403/403 matrix
- [Phase ?]: [Phase 36-01]: No literal import 'server-only' — Next 16 vendors it internally; server-only enforced by convention (call-time env, never NEXT_PUBLIC_*, only resolved map to client)
- [Phase ?]: [Phase 36-01]: loadCopy wraps resolveCopy in unstable_cache (revalidate:300, tags:['copy']) so the resolved map incl. fallback is cached — fallback as cheap as happy path
- [Phase ?]: [Phase 36-01]: runtime resolver does one bulk Strapi fetch (pageSize=1000); pagination lives only in the manual copy:snapshot script, never in build (D-04)
- [Phase ?]: 36-02: renderCopy returns React nodes and relies on React text-node escaping (no manual escape) so escape-first holds without double-escaping
- [Phase ?]: 36-02: copy links require explicit http/https/mailto scheme; javascript:/data:/relative URLs drop href and render label as plain text
- [Phase ?]: CopyProvider passes only the resolved copy map client-side; never the server-only lib/copy resolver, token, or CMS URL (grep-gated)
- [Phase ?]: [Phase 37-01]: copy-snapshot.json is the authored source of truth for all 62 bib.* keys (SC-4 floor); import-copy.mjs upserts them into Strapi via a write-only STRAPI_WRITE_TOKEN, distinct from the runtime read-only token
- [Phase ?]: 37-02: server donate/sponsor surface reads catalog via loadCopy+t; reconcile note split around <code>{runnerCode}</code>
- [Phase ?]: 37-03: DonateModal submit CTA interpolated in-component via nested t() (bib.checkout.cta { label, amount }) — SC-2 proven on client
- [Phase ?]: 37-04: ContributionChip async server component via loadCopy; orderform needs no edit
- [Phase ?]: Phase 38-01 bulk-upsert reuses Phase-35 lifecycle write path (uniqueness guard + S3 export) via strapi.db.query inside one transaction; pure bulk-validate.ts holds intra-batch rules
- [Phase ?]: [Phase 38-02]: Copy Catalog admin page mounted via the first register()/addMenuLink injection in the repo (alongside app.tsx config+SSO bootstrap); resolves at /{region}/admin/copy-catalog
- [Phase ?]: [Phase 38-02]: added src/admin/tsconfig.json (admin preset) + excluded src/admin from server tsconfig — standard Strapi-5 split for the first JSX admin page; Vite bundles the admin so npm run build is the import/JSX gate
- [Phase ?]: [Phase 38-02]: admin fetch client targets /api/ui-strings + /api/ui-strings/bulk-upsert (no auto /api prepend); per-row errors map back by payload index, new ids reconciled by (key,locale)
- [Phase ?]: 39-01: Copy floor scoped to exactly what Wave 2 consumes (common.* chrome, bib.txn.*, bib.admin.*); admin dashboard/access-denied/signin pages stay literal.
- [Phase ?]: 39-01: common.header.donate re-homes the donate trigger; bib.donate.trigger left seeded until 39-04 re-points bib header/menu.
- [Phase 39]: 39-02: run.human copy toolkit installed (ported verbatim from run.bib, D-05); snapshot floor carries byte-identical common.* union (D-07); CopyProvider mounted in both group layouts; zero human.* easy wins authored (D-06 bias-to-defer)
- [Phase ?]: 39-04: TransactionHistory async loadCopy+t; AdminActions useCopy() (module consts removed) — words byte-identical
- [Phase ?]: 53-01: bucket-in-sk atomic ledger + QrValidationError extracted to dependency-free qr-errors.ts for pure helpers
- [Phase 53]: 53-02: verifyTotp built over totpAt across a +/- skew window with length-guarded crypto.timingSafeEqual (NEW; the meshtk Go had generation only); ctf-otp.ts is pure (node:crypto only), never logs secret/guess
- [Phase ?]: 53-03: CtfStore flag-types ops OPTIONAL (static seam stays type-clean); absent op == locked/degraded non-solve; globalMax off atomic ordinal
- [Phase 54]: 54-01: pure client-safe ctf-form-model seam — presetToAdvanced (5 distinct preset tuples so inferChallengeType round-trips), previewPoints delegates to computePoints (preview===judge parity, no duplicate curve), redactCtfSecrets strips otp.secret+effect before server→client prop (SC-2 boundary); imports ONLY @/lib/ctf-scoring, never the judge module. 19 tests, full suite 498 green.
- [Phase 54]: 54-02: split ctf-otp into node-free ctf-otp-core.ts (shared base32Decode→Uint8Array, DataView counterBytes, RFC-4226 truncateHotp, parseOtpauth, DEFAULT_* + types) re-exported by node ctf-otp.ts (every Phase-53 signature intact, existing tests untouched); new browser ctf-otp-client.ts adjacentCodesAsync via globalThis.crypto.subtle HMAC-SHA1 — no node import, no server-module import, no new dependency — parity-tested vs sync adjacentCodes across a secret×time×period matrix + RFC-6238 anchor. Full suite 536 green.
- [Phase 54]: 54-03: first client effect.kind handler — ctf-otp-enroll.ts asOtpEnrollEffect narrows unknown JudgeResult.effect → OtpEnrollEffect|null (kind+non-empty-otpauth+parseOtpauth in try/catch; never throws), new CtfOtpEnroll.tsx "use client" reward card (real QR via existing qrcode dep on a white quiet zone + rolling prev/CURRENT/next code + self-correcting 1s countdown via 54-02 adjacentCodesAsync + otpauth deep link + copy-setup-link + conditional next-flag), dispatched ONLY in ClaimClient's solved&&points>0 branch. Covert-invariant disk-read test (covert-egg/EggTrigger/CtfCelebration/ctf-covert-css/assets-theme carry no reward token) + git-diff-stat gate prove covert channel byte-untouched. 15 new tests. LANDMINE: an inadvertent `git stash` (prohibited — shared across worktrees) shelved the uncommitted ClaimClient edit; recovered via targeted `git stash apply stash@{0}` + drop, sibling stashes preserved, zero loss.
- [Phase 54]: 54-04: CtfForm design-A redesign (Phase 54 DONE, 4/4) — 7 ordered section cards (Name → challenge-type segmented presets → Answer type Static/Rotating-OTP → Scoring window & limits → Unlock & chaining → hand-rolled Advanced disclosure → live scoring preview). Dead standalone `Points` field REMOVED (grep-verified setPoints==0). Live preview binds previewPoints (54-01 adapter → computePoints; judge-parity, no duplicate scorer). Secrets write-only end-to-end: edit page routes getCtf row through redactCtfSecrets (raw `record as CtfRecord` cast GONE; no `secret` token on edit page); CtfForm's CtfRecord aliased to RedactedCtfRecord so the safe shape is the only accepted prop; answer/otp-secret/reward-otpauth/effect never prefilled, blank-on-save keeps stored (no-clobber). applyPreset pre-fills Advanced knobs via presetToAdvanced but never locks them. Static Reward → OTP enrollment configurator: write-only otpauth composes {kind:"otp-enroll",otpauth,nextFlag?} (precedence over raw Effect JSON), Reveal preview REUSES the 54-03 CtfOtpEnroll card. Wordlist NOT rendered; Slice-2 day/time/tz = placeholder note only (D5). New shared qr-ui tokens cls.segment/segmentActive/segmentIdle/chip/rewardCard (slices 55/56 inherit). Zero new deps. Full webapp suite 551 green; touched files tsc-clean (2 pre-existing out-of-scope errors in dropdown-user.tsx + checkin.test.ts untouched).

### Pending Todos

None.

### Blockers/Concerns

- [v1.4 / Phase 19 — HARDWARE-IN-LOOP]: **tlora-t3s3 flashMode 'dio' boot** — verify the explicit branch (`use-flash.ts:104-106`) produces a bootable tlora-t3s3 device. Only remaining v1.4 open item — Kurt didn't have a tlora-t3s3 during 2026-07-02 hardware verification.
- 39-06 Task 2 live SC-3 proof pending operator: run copy:import with STRAPI_WRITE_TOKEN in both apps, then edit one common.* CMS row and confirm wording changes in BOTH bib and run.human live

## Session Continuity

Last session: 2026-07-15T11:00:00.000Z
Stopped at: Completed 54-04-PLAN.md (CtfForm design-A redesign + reward configurator) — Phase 54 complete (4/4). Milestone v2.3 next phase: 55 (Slice 2 scoring windows).
Resume file: None — Phase 54 done; next is Phase 55 (CTF Slice 2 Scoring Windows) or land/PR the Slice-1b work.

## Operator Next Steps

- Plan the first v1.9 phase with `/gsd-plan-phase 35`

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 33 P01 | 30m | 3 tasks | 7 files |
| Phase 33 P02 | 25min | 3 tasks | 7 files |
| Phase 33 P03 | 12min | 2 tasks | 14 files |
| Phase 33 P04 | ~25m | 2 tasks | 1 files |
| Phase 33 P06 | 8min | 2 tasks | 15 files |
| Phase 35 P01 | 5m | 3 tasks | 5 files |
| Phase 35 P02 | 8m | 3 tasks | 5 files |
| Phase 35 P03 | 6m | 2 tasks | 1 files |
| Phase 36 P01 | 50min | 2 tasks | 7 files |
| Phase 36 P02 | 6 | 1 tasks | 2 files |
| Phase 36 P03 | 15min | 2 tasks | 3 files |
| Phase 37 P01 | 12min | 3 tasks | 4 files |
| Phase 37 P02 | 12m | 3 tasks | 4 files |
| Phase 37 P03 | 6min | 3 tasks | 5 files |
| Phase 37 P04 | 15m | 3 tasks | 3 files |
| Phase 37 P05 | ~12m | 3 tasks | 5 files |
| Phase 38 P01 | 15min | 2 tasks | 4 files |
| Phase 38 P02 | ~7min | 2 tasks | 4 files |
| Phase 39 P39-01 | 5m | 3 tasks | 3 files |
| Phase 39 P39-02 | ~6m | 3 tasks | 10 files |
| Phase 39 P39-03 | 8m | 2 tasks | 3 files |
| Phase 39 P39-04 | ~10m | 2 tasks | 2 files |
| Phase 39 P05 | 3min | 2 tasks | 4 files |
| Phase 53 P02 | 3min | 2 tasks (TDD RED/GREEN) | 2 files |
| Phase 53 P03 | 8min | 2 tasks | 2 files |
| Phase 54 P01 | ~10m | 2 tasks (TDD RED/GREEN) | 2 files |
| Phase 54 P02 | ~15m | 2 tasks (refactor + TDD RED/GREEN) | 4 files |
| Phase 54 P03 | ~20m | 3 tasks (TDD RED/GREEN + 2 feat) | 5 files |
| Phase 54 P04 | ~20m | 3 tasks (feat) | 3 files |
