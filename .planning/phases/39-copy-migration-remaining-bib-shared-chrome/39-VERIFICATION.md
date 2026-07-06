---
phase: 39-copy-migration-remaining-bib-shared-chrome
verified: 2026-07-06T16:49:07Z
status: human_needed
score: 7/8 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "Editing one shared common.* CMS row changes the wording in BOTH bib.defcon.run and run.defcon.run live — no shared React component change, no deploy (SC-3 headline de-dup proof)"
    test: "Operator exports CMS_INTERNAL_URL + write-capable STRAPI_WRITE_TOKEN, runs `npm run copy:import` in apps/run.bib/webapp and apps/run.human/webapp, then edits ONE shared common.* row (e.g. common.header.maps 'Maps' -> 'Maps!') in the Strapi Copy Catalog admin. Wait ~5 min (revalidate window). Revert the row after."
    expected: "The changed wording appears in BOTH bib.defcon.run AND run.defcon.run with no code deploy and no shared component touched. The de-dup win is demonstrated live, not latent."
    why_human: "Requires an operator-supplied write-capable token (distinct from the runtime read-only token) and live prod access. Runtime cross-region propagation is a state transition grep/presence checks cannot see; no token is available in an autonomous background session. This is the planned checkpoint:human-verify (39-06 Task 2, gate=blocking)."
human_verification:
  - test: "Operator import: with CMS_INTERNAL_URL + STRAPI_WRITE_TOKEN exported, run `npm run copy:import` in apps/run.bib/webapp AND apps/run.human/webapp"
    expected: "Each prints a created/updated tally and exits 0; common.*/bib.*/human.* rows land once in the shared Strapi catalog under correct namespaces (idempotent upsert by key)"
    why_human: "Requires a write-capable token supplied only at import time; never committed or in runtime env. No token in this autonomous run."
  - test: "SC-3 live cross-app edit — edit one shared common.* row in the CMS admin, confirm it changes wording in BOTH prod apps after the revalidate window, then revert"
    expected: "One CMS edit changes wording in both bib.defcon.run and run.defcon.run; no deploy, no shared React component change"
    why_human: "Live CMS write + cross-region time-based revalidation on prod; not exercisable without operator + live catalog."
  - test: "SC-1 / SC-2 live render — load bib.defcon.run and run.defcon.run after import"
    expected: "Header nav, mobile menu, profile menu, footer, and bib transaction-history + admin surfaces show normal words, NEVER a raw dotted key (e.g. never a literal 'common.header.maps')"
    why_human: "Visual confirmation of live rendered chrome on prod after the catalog is seeded."
  - test: "FALL-04 live fallback — with the CMS unreachable, load both apps"
    expected: "Both apps still render chrome from their snapshot `default` floor — normal words, never `{}` and never a raw dotted key"
    why_human: "Requires exercising the live CMS-down path against a deployed instance."
---

# Phase 39: Copy Migration — Remaining Bib + Shared Chrome Verification Report

**Phase Goal:** The rest of bib's copy and the shared header/profile-menu chrome read from catalog keys, unifying the copy-pasted words across every app without touching the per-app React components (words-only).
**Verified:** 2026-07-06T16:49:07Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This is a WORDS-ONLY copy migration. Per the phase decisions (37/39 D-05, D-04, D-06, D-07), "no visible word change" is a REQUIREMENT, not a gap. Per-variant keys that keep each app's current word (e.g. bib `common.profileMenu.signOut` = "Sign out" vs run.human `common.profileMenu.logout` = "Logout") are correct and intentional. run.auth/run.flash/run.gpx chrome and run.human's deep surfaces are deferred by design to MIGR-04. None of these are treated as gaps.

All OFFLINE/STRUCTURAL portions of every success criterion are machine-verified and pass. The only remaining work is the LIVE operator import + the SC-3 cross-app edit demonstration on prod — a planned `checkpoint:human-verify` (39-06 Task 2, gate=blocking) that cannot run in a tokenless autonomous session.

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | SC-1: remaining run.bib copy (TransactionHistory, AdminActions) resolves from catalog keys; no inline literals on migrated surfaces (MIGR-02) | ✓ VERIFIED | `bib.txn.*` (5 keys) + `bib.admin.*` (7 keys) in snapshot floor; TransactionHistory reads `loadCopy('default')`+`t(copy,'bib.txn.*')`; AdminActions reads `useCopy()`+`t('bib.admin.*')`; visible labels are `t()` reads (only aria-label/textValue/numeric/error-detail remain literal per D-04); SC-1 exclusion set documented in 39-01-SUMMARY |
| 2 | SC-2: shared chrome keyed under common.header.* / common.profileMenu.*; each app renders those labels through t() from the same keys (MIGR-03) | ✓ VERIFIED | 17 `common.*` keys in both snapshots; bib chrome (header/menu-dropdown/user-dropdown) and human chrome (header/dropdown-user/dropdown-menu/footer) both read `common.*` via `useCopy()`; visible labels confirmed as `t()` reads in user-dropdown.tsx |
| 3 | SC-3 (structural de-dup): a shared common.* key is read by BOTH apps' chrome, so one edit reaches both readers | ✓ VERIFIED | 9 `common.*` keys read by BOTH apps' chrome: `common.header.{maps,meshtastic,bib,donate}` + `common.profileMenu.{cms,gpsCheckin,myBib,profile,showQr}` (comm -12 overlap); cross-snapshot byte-equality locked by Test D in both guard suites |
| 4 | SC-3 (live): editing one common.* CMS row changes wording in BOTH prod apps, no shared component, no deploy | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Both readers wired to identical keys and floors byte-equal, but the runtime edit-once-changes-both propagation needs operator write token + live prod — see Human Verification |
| 5 | FALL-04: CMS-down fallback renders from snapshot `default` floor, never `{}` / raw dotted key | ✓ VERIFIED (offline) | copy-core `t` resolves `map[key] ?? key`; both floors carry every `common.*` key so the map never lacks one; 39-06 offline replica proved 17/17 common.* resolve to real words, 0 empty/raw-dotted. Live prod fallback = human item |
| 6 | D-07 invariant: the two apps' common.* snapshot subsets are byte-identical (guarded) | ✓ VERIFIED | `diff` of sorted common.* JSON subsets prints nothing (IDENTICAL, 17 keys each); Test D reads sibling snapshot off disk and deep-equals — drift is a red test in both suites (negative-proof recorded in 39-06-SUMMARY) |
| 7 | run.human has the toolkit installed (loadCopy/t server, useCopy client) + CopyProvider mounted in BOTH group layouts (D-05) | ✓ VERIFIED | copy.ts / copy-core.ts / copy-markdown.tsx / CopyProvider.tsx present in run.human; copy.ts reads CMS_INTERNAL_URL + STRAPI_API_TOKEN; CopyProvider + loadCopy present in both (protected) and (public) layouts |
| 8 | Import scripts are namespace-aware (per-key prefix, enum-guarded) and token-safe (missing env -> exit 1, no CMS call, no reserved locale query) | ✓ VERIFIED | Both apps' import-copy.mjs use `key.split('.')[0]` namespace derivation; missing-env run exits 1 in both; `filters[locale]` appears only in explanatory comments, never a request URL |

**Score:** 7/8 truths verified (1 present, behavior-unverified — the SC-3 live cross-app edit)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `apps/run.bib/webapp/src/lib/copy-snapshot.json` | common.* union (17) + bib.txn.* + bib.admin.* floor | ✓ VERIFIED | 17 common.* + 5 bib.txn.* + 7 bib.admin.* keys present |
| `apps/run.human/webapp/src/lib/copy-snapshot.json` | byte-identical common.* union + bounded human.* | ✓ VERIFIED | common.* identical to bib; 0 human.* keys (bias-to-defer honored, D-06) |
| `apps/run.bib/webapp/scripts/import-copy.mjs` | namespace-aware, token-safe | ✓ VERIFIED | split('.') derivation, enum-guarded, exit 1 on missing env |
| `apps/run.human/webapp/scripts/import-copy.mjs` | ported namespace-aware import | ✓ VERIFIED | same as bib; copy:import package script present |
| `apps/run.human/webapp/src/lib/{copy.ts,copy-core.ts,copy-markdown.tsx}` | ported toolkit | ✓ VERIFIED | all present, read correct env names |
| `apps/run.human/webapp/src/components/CopyProvider.tsx` | ported provider | ✓ VERIFIED | present; mounted in both layouts |
| bib chrome (header/menu-dropdown/user-dropdown/footer) | read common.* via useCopy | ✓ VERIFIED | wired; footer is brand-token-only (nothing to migrate, documented) |
| human chrome (header/dropdown-user/dropdown-menu/footer) | read common.* via useCopy | ✓ VERIFIED | wired to same keys as bib |
| bib TransactionHistory / AdminActions | read bib.txn.* / bib.admin.* | ✓ VERIFIED | server loadCopy+t / client useCopy respectively |
| guard tests (both apps) | key-floor + token-boundary + Test D cross-snapshot | ✓ VERIFIED | bib 10/10, human 4/4 pass (node v23.6.0) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| bib chrome components | common.* snapshot keys | `useCopy()` + `t()` | ✓ WIRED | 9 shared keys read by both apps' chrome |
| human chrome components | same common.* keys | `useCopy()` + `t()` | ✓ WIRED | CopyProvider mounted both layouts feeds useCopy |
| both group layouts | CopyProvider | `loadCopy('default')` -> `value` | ✓ WIRED | loadCopy present in both, wraps Header/Footer tree |
| snapshot floors | shared CMS catalog rows | namespace-aware import | ⚠️ import-time (operator) | Script correct + token-safe; live seed pending operator |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| bib guard test (key-floor + token-boundary + Test D) | `npx vitest run src/__tests__/copy-catalog-bib.test.ts` | 10 passed | ✓ PASS |
| human guard test (key-floor + token-boundary + Test D) | `npx vitest run src/lib/__tests__/copy-catalog-human.test.ts` | 4 passed | ✓ PASS |
| common.* subsets byte-equality | `diff` of sorted common.* JSON | prints nothing (identical) | ✓ PASS |
| import missing-env guard (bib + human) | `env -u STRAPI_WRITE_TOKEN -u CMS_INTERNAL_URL node scripts/import-copy.mjs` | exit 1, no CMS call | ✓ PASS |
| token boundary — no client file imports server resolver | grep `use client` files importing `@/lib/copy` | none | ✓ PASS |
| live cross-app edit / prod render / live fallback | (requires operator + live CMS) | — | ? SKIP -> human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MIGR-02 | 39-01, 39-04 | Remaining run.bib copy migrated to catalog keys | ✓ SATISFIED (structural) | TransactionHistory + AdminActions read bib.txn.* / bib.admin.*; SC-1 exclusion set documented. Live render = human item |
| MIGR-03 | 39-01, 39-02, 39-03, 39-05, 39-06 | Shared chrome under common.*; every app reads same keys | ✓ SATISFIED (structural) | 17 byte-identical common.* keys; both apps' chrome wired via t(); 9 keys read by both. Live SC-3 = human item |

Both requirement IDs from PLAN frontmatter (MIGR-02, MIGR-03) are accounted for. MIGR-04 (run.auth/run.flash/run.gpx + run.human deep surfaces) is correctly deferred to v2 per REQUIREMENTS.md and 39-CONTEXT.md Deferred Ideas — not a gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TODO/FIXME/XXX/TBD/placeholder markers on any migrated component | ℹ️ Info | Clean |

The `filters[locale]` string appears only inside explanatory comments in both import scripts (the Strapi-5 reserved-locale landmine warning) — never in a request URL. Not an anti-pattern.

### Human Verification Required

The live proof is a planned blocking operator checkpoint (39-06 Task 2). It needs a write-capable `STRAPI_WRITE_TOKEN` (distinct from the runtime read-only token) and live prod access — neither available in an autonomous session. Four items:

1. **Operator import** — run `npm run copy:import` in both apps with the write token; each prints a created/updated tally and exits 0.
2. **SC-3 live cross-app edit** — edit one shared `common.*` row in the CMS admin; confirm it changes wording in BOTH prod apps after the revalidate window; revert. This is the headline de-dup proof (behavior-unverified truth #4).
3. **SC-1 / SC-2 live render** — load both prod apps; confirm chrome + bib prose show normal words, never a raw dotted key.
4. **FALL-04 live fallback** — with the CMS unreachable, confirm both apps render chrome from the snapshot floor.

### Gaps Summary

No gaps. Every offline/structural portion of SC-1, SC-2, SC-3, FALL-04, and the D-07 shared-floor invariant is machine-verified: 17 byte-identical common.* keys wired into both apps' chrome via t()/useCopy, bib remaining copy migrated to bib.txn.*/bib.admin.*, toolkit ported into run.human with CopyProvider mounted in both group layouts, namespace-aware token-safe import scripts, and passing guard tests (bib 10/10, human 4/4) including cross-snapshot byte-equality. The only remaining work is the live operator import + SC-3 prod demonstration — expected human-action items per the plan's blocking checkpoint, not defects. Status is `human_needed`.

---

_Verified: 2026-07-06T16:49:07Z_
_Verifier: Claude (gsd-verifier)_
