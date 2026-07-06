# Phase 39: Copy Migration — Remaining Bib + Shared Chrome - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 39-copy-migration-remaining-bib-shared-chrome
**Areas discussed:** App scope of MIGR-03, Footer inclusion, common-vs-bib chrome boundary, Bib remaining-copy sweep, run.human toolkit port, run.human scope fence

---

## App scope of MIGR-03 ("every app")

| Option | Description | Selected |
|--------|-------------|----------|
| Bib-only, establish common.* | Migrate bib chrome to common.* keys with bib as sole reader; de-dup win latent until MIGR-04 lands app #2 | |
| Bib + wire run.human live | Also install toolkit in run.human + point its chrome at same common.* keys; CMS edit changes BOTH apps live this phase | ✓ |
| Bib + all React apps | Toolkit + chrome across human, auth, and bib now (pulls most of MIGR-04 forward) | |

**User's choice:** Bib + wire run.human live
**Notes:** User wants the copy-paste de-dup payoff *demonstrated* live this phase, not deferred. run.auth stays MIGR-04; run.gpx (Svelte) hard-out. De-risked in-session: run.human already carries `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` config, so the toolkit read path plugs into existing infra.

---

## Footer inclusion

| Option | Description | Selected |
|--------|-------------|----------|
| Skip footer (brand token) | Leave footer literal — wordmark is a brand/logo token, version is dynamic | |
| Include common.footer.* | Migrate footer wordmark as common.footer.* for completeness/editability | ✓ |

**User's choice:** Include common.footer.*
**Notes:** Footer is in-scope. Whether the `defcon.run 34` wordmark itself (a brand token) migrates vs. only version-adjacent copy left to planner discretion.

---

## common-vs-bib chrome boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Profile menu = common, nav = bib | Only genuinely-shared chrome under common.*; bib's own top-nav (Maps/Meshtastic/Bib) stays bib.header.* | |
| All chrome under common.* | Header nav + profile menu + footer all under common.* regardless of literal cross-app sharing | ✓ |

**User's choice:** All chrome under common.*
**Notes:** Single unified chrome namespace. Justified because the nav items (Maps/Meshtastic/Bib) are byte-identical between bib and run.human today anyway.

---

## Bib remaining-copy sweep

| Option | Description | Selected |
|--------|-------------|----------|
| Visible prose + a full sweep | TransactionHistory + AdminActions + sweep for stray literals so SC-1 holds; aria/error-detail stay literal | ✓ |
| Named surfaces only | Just TransactionHistory + AdminActions + enumerated chrome; no stray-literal hunt | |

**User's choice:** Visible prose + a full sweep
**Notes:** SC-1 ("no inline string literals left on migrated surfaces") must genuinely hold. Carries 37 D-03: aria-labels + error DETAIL/interpolation tokens stay literal.

---

## run.human toolkit port

| Option | Description | Selected |
|--------|-------------|----------|
| Copy toolkit into run.human | Port the 5 toolkit files from bib into run.human, matching repo copy-paste convention + no-new-deps | ✓ |
| Extract shared toolkit package | Shared workspace package both apps import; cleaner but new build wiring, against convention | |

**User's choice:** Copy toolkit into run.human
**Notes:** Matches the repo norm (DonateModal already byte-copied across apps). Accepted cost: two divergent toolkit copies. Mount detail flagged: run.human has no root layout — CopyProvider must wrap both `(protected)` and `(public)` group layouts.

---

## run.human scope fence

| Option | Description | Selected |
|--------|-------------|----------|
| Chrome only (header/menu/footer) | Only run.human chrome reads common.*; everything else stays MIGR-04 | |
| Chrome + any easy run.human wins | Chrome plus opportunistic static run.human strings while toolkit is installed | ✓ |

**User's choice:** Chrome + any easy run.human wins
**Notes:** Guardrailed (CONTEXT D-06): "easy wins" = clearly-static, low-risk visible prose under `human.*`; interpolation-heavy / deep-client-state surfaces (CheckInModal, dashboard, profile, QR) stay MIGR-04. Bias to defer — do not balloon run.human's review surface.

---

## Claude's Discretion

- Exact leaf key names per literal (author during execution; stable once seeded).
- Where the run.human `human.*` "easy wins" boundary sits (planner judgment under the D-06 guardrail; bias to defer).
- CopyProvider mount mechanics across run.human's two group layouts.
- Whether the footer wordmark migrates or only version-adjacent copy.
- Wave split (ROADMAP hints parallel waves per surface; toolkit-port gates human chrome wiring).
- Whether `bib.donate.trigger` (37 D-07) re-homes to `common.header.*` now that all chrome unifies.

## Deferred Ideas

- run.auth / run.flash / run.gpx chrome + toolkit adoption — MIGR-04 / v2 (gpx Svelte permanently out for the React toolkit).
- run.human complex surfaces (CheckInModal, dashboard, profile map/history, QR) — MIGR-04.
- Other apps' DonateModal copies — MIGR-04 / v2 (37 D-09 caveat).
- Shared toolkit package extraction — rejected this phase; revisit if divergence bites.
- Manual `revalidateTag('copy')` instant propagation — v1 rides time-based revalidation.
- aria-label / a11y-string catalog coverage — intentionally out.
- Per-locale authoring beyond `default` — whole-milestone YAGNI.
