---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
verified: 2026-07-30T22:54:12Z
status: passed
score: 21/21 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: yes
behavior_unverified_resolved:
  - item: "Master checkbox auto-folds its section (ROADMAP SC-1 collapse-on-visibility-transition)"
    resolved_by: "UAT test 6, Kurt 2026-07-30: \"it folds, works, things are fine\""
    note: >-
      Confirmed by hand, not by the probe. Assertion 15 clicks section chevrons and
      never a master checkbox, so the `prev !== undefined && prev !== group.visible`
      branch is still unexercised automatically. Probe-coverage gap, not a defect.
re_verification_detail:
  previous_verified: 2026-07-30T14:04:05Z
  previous_status: gaps_found
  previous_score: 19/21
  gaps_closed:
    - truth: "The footer shows quiet helper text on the left and the primary Add run button on the right (ROADMAP SC-3: 'Add run as the footer primary')"
      was: >-
        CR-02 / gap 1, the phase-introduced regression. The My Maps rebuild moved the
        "Add run" control out of the auth-gated body into an UNCONDITIONAL
        `{#snippet footer()}`, so the filled primary CTA also painted on the sign-in and
        access-denied gate screens. Clicking it closed My Maps, opened nothing
        (QuickStartHub's `canShow` gates on the same two conditions), took the Sign In
        button off screen with it, and left `quickStartOpen` latched true with no
        consumer mounted to reset it. Live in prod as v0.0.104.
      closed_by: "PR #1112 → v0.0.105"
      evidence: >-
        `CloudStorage.svelte:611` now reads
        `footer={$isAuthenticated && $hasGpxStudioAccess ? addRunFooter : undefined}` —
        the snippet is hoisted out of the DialogShell call and passed as a PROP, which is
        the shape the gap required: DialogShell draws the chrome with `{#if footer}` and a
        snippet is always truthy, so guarding inside the body would still have painted the
        empty `border-t px-4 py-3` strip. The belt-and-braces half also landed:
        `openAddRun` (`:585-589`) opens with
        `if (!get(isAuthenticated) || !get(hasGpxStudioAccess)) return;`. Probe assertion
        13 discriminates for real — pre-deploy 12/13 with
        `FAIL 13 ... 1 "Add run" button(s) on the gate screen`, post-deploy 13/13. Kurt
        confirmed from the user side (70-UAT.md test 5, passed).
    - truth: "Version history stays available when a file has more than one version (plan 04) — and reads that file's versions"
      was: >-
        CR-01 / gap 2. Correctly classified in the first pass as PRE-EXISTING, byte-identical
        to `6fe5cf20`, NOT introduced by this phase — recorded as a gap only because the
        phase moved the trigger from a click-only `DropdownMenu.Root` to a bits-ui
        `DropdownMenu.Sub` that opens on pointer-enter, widening the window in which the
        single shared, never-reset `fileVersions` buffer could render — and, via
        `handleLoadVersion(file, ver.version)`, ACTION — another file's version list.
      closed_by: "PR #1112 → v0.0.105 (same PR)"
      evidence: >-
        `CloudStorage.svelte:117-118` — `fileVersions` and `versionHistoryCurrent` are now
        `Record<string, ...>` keyed by fileId. `fetchVersionHistory` (`:385-413`) clears
        THIS file's entry before the await and writes only `[file.fileId]` on both the
        success and catch paths; the render reads `fileVersions[file.fileId] ?? []`
        (`:942, :948`) and `versionHistoryCurrent[file.fileId]` (`:956`). This is the
        gap's second stated remedy ("...or key the buffer by fileId"), and it makes the
        cross-file render structurally impossible rather than merely unlikely.
  gaps_remaining: []
  regressions: []
  later_fixes_checked:
    - "PR #1116 / v0.0.106 — `[&>*]:shrink-0` on the DialogShell body (sections were crushed, never scrolled). Additive class only; no other change to the shell."
    - "PR #1120 / v0.0.107 — `stores/layer-section-collapse.ts`. Collapse moved from in-dialog `$state` to a persisted store. Section order, kit API, master/dim/cascade wiring all unchanged; per-section defaults preserved via `?? !visible` fallbacks."
    - "PR #1123 / v0.0.108 — `stores/layer-visibility.ts`. BEYOND phase 70 scope, judged as such. Toggle semantics unchanged (`setRouteVisible`/`setDayVisible`/`setAllVisible` keep their bodies and their `fit` behaviour); the store only resolves initial state and persists leaves."
behavior_unverified_items:
  - truth: "Turning a group's master checkbox off collapses and dims that group and cascades OFF to its child rows, exactly as it does today (ROADMAP SC-1)"
    test: >-
      Signed in on https://gpx.defcon.run/use1/studio/app, open Map Layers. Uncheck the
      rightmost master checkbox in the DEF CON 34 ROUTES header. Re-check it. Repeat on
      USER CHECK-INS and on a day sub-section of MY DEF CON RUNS.
    expected: >-
      Master OFF folds that card shut, dims its uppercase label to ~55% opacity, and turns
      every child row off on the map. Master ON re-expands and restores them. Afterwards
      the chevron still folds/unfolds freely without the effect fighting it. The
      section-wide MY DEF CON RUNS master must not fire a fitBounds per con day.
    why_human: >-
      NARROWED but not closed by the re-verification. Probe assertion 15 toggles every
      section's CHEVRON and proves the collapse store round-trips a close/reopen — which
      exercises the effect's `prev === undefined` SEEDING branch and proves the effect does
      not clobber a manual fold. It never clicks a master checkbox, so the
      `prev !== undefined && prev !== visible` TRANSITION branch — the one that turns a
      master-off into a fold — has still never executed under test. Assertion 16 only READS
      a row checkbox. gpx-studio has no test runner. 70-UAT.md's five items came from the
      `human_verification` list; this item was on the separate `behavior_unverified_items`
      list and was never put to Kurt, so his blanket "everything is looking good" cannot be
      stretched to cover it. Residual blast radius is small: if the branch misfired the
      card simply would not auto-fold — visibility and cascade would be unaffected.
human_verification:
  - test: >-
      Open Map Layers signed in, uncheck the DEF CON 34 ROUTES master checkbox, then
      re-check it. Repeat on USER CHECK-INS and one MY DEF CON RUNS day.
    expected: >-
      The card folds and its label dims on master OFF, every child row goes off the map,
      and both reverse on master ON — with the chevron still working freely afterwards.
    why_human: >-
      See `behavior_unverified_items` above. This is the single outstanding item; it is a
      ~30-second check and it is the last untested clause of ROADMAP SC-1.
deferred: []
---

# Phase 70: gpx-studio Shared Dialog Shell (Map Layers + My Maps) — Verification Report

**Phase Goal:** Replace the hover-opened layers popover and the icon-strip My Maps dialog
with two centered dialogs built from ONE shared component kit; presentation-layer only,
all layer/data wiring untouched; fully autonomous delivery through a live prod probe.

**Verified:** 2026-07-30T22:54:12Z (re-verification) · 2026-07-30T14:04:05Z (initial)
**Status:** human_needed (was: gaps_found)
**Re-verification:** YES — after gap closure. Both original gaps closed; three later fixes
independently checked for regression against the phase's original deliverables.
**Ship state:** merged and deployed through **v0.0.108** (use1). No deploy, merge, or
workflow dispatch was performed by this verification.

---

## Re-Verification Summary (read this first)

**Both gaps from the initial pass are genuinely closed in the code, not just in a SUMMARY.**
Neither closure was taken on narrative: each was read in the current source, diffed against
the phase commit `db85b258`, and — for gap 1 — corroborated by a probe assertion that
provably fails against the old bundle and passes against the new one.

**The three later fixes did not regress anything the phase delivered.** Checked
specifically, one by one, against the phase's own contract:

| Phase-70 deliverable | Still intact? | How checked |
|---|---|---|
| The shared kit (`dialog-shell/`, 6 components + barrel) | ✓ | Unchanged except the one additive `[&>*]:shrink-0` class on DialogShell's body. `Section.svelte` byte-unchanged since `db85b258`. Six consumers still import through `index.js`; zero relative-path bypasses |
| Deleted hover-open wiring | ✓ | `grep -E "onmouseenter\|onmouseleave\|onpointerenter\|openLayerControl\|closeLayerControl\|cancelEvents"` across the whole `layer-control/` dir and `CloudStorage.svelte`: **zero hits**. The only surviving `onmouseleave` in the phase surface is DialogShell's hint-bar reset, which is by design |
| Removed native `title=` tooltips | ✓ | `grep title=` across `layer-control/`, `dialog-shell/`, `CloudStorage.svelte`: **zero hits**. Probe assertion 12 inspected 2 file rows live on every post-deploy run; assertion 4 inspected 15 layer rows on two of them |
| Section order (BASEMAP → USER CHECK-INS → route groups → MY DEF CON RUNS → COMMUNITY ROUTES) | ✓ | `LayerControl.svelte:491-522` — order and per-section `{#if}` length guards unchanged; the only diff is `collapsed`/`ontoggle` now reading the persisted store instead of local runes |
| Layer wiring / "presentation-layer only" | ✓ (with a scope note) | `setRouteVisible` / `setDayVisible` / `setGroupVisible` / `setAllVisible` keep their bodies and their `fit` semantics; `setDayVisible(..., fit)` still gates `if (visible && fit) this.fitToRoutes(...)`. PR #1123 **did** edit the three layer classes — which the phase's own scope said it would not — but only to resolve initial state and persist leaves. That is post-phase work, judged on its own terms per instruction, and it does not alter any user-driven toggle path |

**Live-code proof, run today, not read from a transcript.** `curl` of
`https://gpx.defcon.run/use1/studio/app` returns entry chunk `start.CO7vXkJK.js` — the
**same** entry chunk recorded in the 16/16 transcript header — and a walk of all 108
referenced chunks finds `dc34LayerSectionCollapse`, `dc34LayerVisibility`,
`data-dc34-layers-btn` and `Hover a row for details` all present in `-3EQvpm5.js`. The
16/16 probe result therefore describes the bundle that is serving right now.

**Why the status is `human_needed` and not `passed`.** Exactly one item is open, and it is
not a gap: the master-checkbox → collapse transition (ROADMAP SC-1) still has no test that
executes it. Probe assertion 15 narrowed it substantially but does not close it — see the
dedicated section below. Nothing blocks Phase 71.

---

## Goal Achievement

The structural goal was achieved at the original ship and remains achieved. The two defects
that stopped it closing clean are gone, and four production probes — each with a recorded
pre-deploy failure of exactly the new assertion — carry the evidence.

### Observable Truths

Rows whose status changed since the initial pass are marked **(was: …)**.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking the layers control opens a centered "Map Layers" dialog; it never opens on hover and never closes on mouse-leave | ✓ VERIFIED | Prod probe assertions 2 (hover → 0 dialogs) and 3 (click → visible `role=dialog`). `LayerControl.svelte:466-477` is a plain `<button onclick={() => (open = true)}>`. Re-grepped today across the whole `layer-control/` dir: zero hits for any of the six deleted hover-open tokens |
| 2 | Every section renders through ONE shared `Section` card — a single rotating-chevron collapse affordance (no icon node swap), uppercase tracked label, count badge, master checkbox rightmost | ✓ VERIFIED | `Section.svelte:45-92` — one `<ChevronDown>` with a `-rotate-90` toggle, then count (78-80) → `menu` (82) → master (84-92). File is byte-unchanged since `db85b258`. All six consumers import it from the barrel |
| 3 | Turning a group's master checkbox off collapses and dims that group and cascades OFF to its child rows, exactly as today | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Narrowed, not closed. Dimming (`Section.svelte:68-71`) is a pure derived class; the cascade runs through pre-existing layer-class bodies. The COLLAPSE half is a rewritten `$effect` whose transition branch is still unexecuted by any test — assertion 15 exercises only the seeding branch. See the dedicated section below |
| 4 | Basemap switching, per-route toggles and check-in filters still drive the map identically | ✓ VERIFIED | `setAggregateVisible`/`setCheckInsVisible`/`setGroupVisible`/`setRouteVisible` still take the kit's `v` boolean; `setCheckInFilters` payloads unchanged; `toggleType` untouched. PR #1123's edits to the layer classes add persistence calls and initial-state resolution only — every user-driven toggle body is intact, and `setDayVisible`'s `fit` gate survives verbatim |
| 5 | Zero native `title=` tooltips on route/file rows; descriptions travel via `data-hint` | ✓ VERIFIED | Source grep: zero `title=` across `layer-control/`, `dialog-shell/`, `CloudStorage.svelte`. Probe assertion 4 (15 rows) and 12 (2 rows) live. Correction to the initial report: `StravaStrip.svelte` DOES still carry three `title=` attributes (`:406, :441, :657`) — but they are on the strip's hide/refresh buttons and a popover day chip, are pre-existing (the phase's whole StravaStrip diff is 8 lines), and are outside DLGS-04's stated "route/file ROWS" scope |
| 6 | Hovering or keyboard-focusing a hinted element updates the hint bar; leaving restores the default copy | ✓ VERIFIED | Probe assertions 6 and 7, green on every post-deploy run. `DialogShell.svelte:34-37, 90-92` |
| 7 | Map Layers section order is BASEMAP → USER CHECK-INS → route groups → MY DEF CON RUNS → COMMUNITY ROUTES; empty sections hidden | ✓ VERIFIED **(was: VERIFIED, partially exercised live)** | Source order at `LayerControl.svelte:491-522` unchanged. The live gap is now closed by human evidence: 70-UAT.md test 1 (signed in, real con-day runs and a published community route) **passed** — MY DEF CON RUNS and COMMUNITY ROUTES render in the contracted positions |
| 8 | Esc and overlay click close the dialog and focus returns to the layers button | ✓ VERIFIED | Probe assertion 8. `LayerControl.svelte:485-488` refocuses `layersBtn` on close |
| 9 | Every layer instance created in `map.onLoad`, the async-auth loads, the day-assign popup bridge and the run-reload subscription behave exactly as before | ✓ VERIFIED | Zero diff in those blocks at the phase commit; the post-phase LayerControl diff touches only the collapse-store import, the `quickStartAction` unfold, and the two `collapsed`/`ontoggle` bindings |
| 10 | QuickStart hub `routes` / `runners` still reveal their layers and open the dialog | ✓ VERIFIED | `LayerControl.svelte:414-424` — `setGroupVisible(..., true)` and `open = true` intact. PR #1120 ADDED an explicit `setSectionCollapsed(groupSection(...), false)` so the §5b "Check out the routes" card still reveals the groups EXPANDED now that the effect deliberately no longer writes collapse on its first sighting. That is a considered preservation of the behaviour, not a regression |
| 11 | `LayerTree.svelte` is NOT modified — it still serves the overlays tree and LayerControlSettings | ✓ VERIFIED | `git diff db85b258^ HEAD` for `LayerTree.svelte`, `LayerTreeNode.svelte`, `LayerControlSettings.svelte` is **empty** across the phase AND all four later fixes |
| 12 | My Maps opens as the shared 420px shell: cloud glyph, heading, breadcrumb-aware subheading, scrollable carded body, footer, hint bar | ✓ VERIFIED | `CloudStorage.svelte:605-613`; shell width `!max-w-[420px]` at `DialogShell.svelte:43`. The "scrollable" clause is now actually PROVEN rather than assumed — probe assertion 14, `clientH=562 scrollH=2113`, a 1400px filler rendering at its full 1400px and `scrollTop=400`, against a pre-deploy `scrollH=562` / filler crushed to 336px / `scrollTop=0` |
| 13 | MY FILES precedes SHARED WITH YOU in DOM order | ✓ VERIFIED | Probe assertion 10 on every post-deploy run |
| 14 | The MY FILES header overflow menu houses New folder, Refresh and Export all — the floating top-right icon pair is gone | ✓ VERIFIED | `CloudStorage.svelte` `{#snippet menu()}` unchanged since the phase commit |
| 15 | Each file row shows ONE labelled Edit button plus an overflow menu with Share, Assign day, Save as Route, Export GPX and a red separated Delete; version history available when a file has >1 version — and reads that file's versions | ✓ VERIFIED **(was: VERIFIED, defect noted)** | Row action set unchanged. The version-history defect (gap 2) is closed: buffers keyed by fileId at `:117-118`, per-file reset before the await at `:391-394`, per-file reads at `:942/948/956`. Residual, cosmetic only: the `finally` still clears `loadingVersions` unconditionally, so with two overlapping fetches the second submenu can flash "No versions found" before its own data lands — it can no longer show or action ANOTHER file's versions, which was the actual harm |
| 16 | Row actions fade in on hover or keyboard focus on pointer devices and are always visible on touch viewports | ✓ VERIFIED | `CloudStorage.svelte` row classes unchanged since the phase commit |
| 17 | The footer shows quiet helper text on the left and the primary Add run button on the right, with the hint bar below it | ✓ VERIFIED **(was: ✗ FAILED — BLOCKER)** | Gap 1 closed. `:611` `footer={$isAuthenticated && $hasGpxStudioAccess ? addRunFooter : undefined}` — passed as a PROP, which is the only shape that drops the chrome row too. `openAddRun` early-returns on the same pair. Probe assertion 13: pre-deploy FAIL (`1 "Add run" button(s) on the gate screen`) → post-deploy PASS, on the real site. 70-UAT.md test 5 passed |
| 18 | No file row, folder row or action control carries a native tooltip attribute | ✓ VERIFIED | Probe assertion 12 (2 rows) on all five post-deploy runs; source grep zero |
| 19 | `CloudStorage` stays a LEGACY-mode component (plain `let` + `$:` only, zero runes) | ✓ VERIFIED | `grep -E '\$state\|\$derived\|\$effect\|\$props\|\$bindable' CloudStorage.svelte` → **exit 1**, zero matches, re-run today against the post-fix file. Both PR #1112 edits stayed in legacy idiom (manual `x = x` self-assignments to trigger reactivity, `get(store)` rather than `$store` inside the guard) |
| 20 | `handleExportFile` reuses `loadFromCloud` + FileSaver — no presigned URL or storage key reaches the DOM; every row-action wrapper keeps `onclick` stopPropagation | ✓ VERIFIED | Unchanged since the phase commit |
| 21 | StravaStrip: imported-untagged shows an actionable "Pick a day"; never-imported shows a quiet "+ Import"; tagged unchanged; popover modes unchanged | ✓ VERIFIED **(was: VERIFIED, visual read pending)** | `StravaStrip.svelte` is byte-unchanged since `db85b258`. The pending visual judgment is now settled by human evidence: 70-UAT.md test 2 **passed** with all three card states present |

**Score:** 20/21 truths verified (0 failed, 1 present but behavior-unverified)

### The one open item: master-checkbox collapse (ROADMAP SC-1)

The prompt's framing was that probe assertion 15 "toggles every section and a real ON/OFF
transition still drives collapse", and asks whether that closes the item. **It does not —
though it comes closer than anything before it.** Read against the probe source rather
than its summary line:

- Assertion 15 clicks `[data-section-chevron]` on every section (`dialog-shell-probe.cjs:706-712`).
  It never touches a checkbox. `grep -n "checkbox" dialog-shell-probe.cjs` returns four
  hits, all inside assertion 16, and all of them **read** `input[type="checkbox"].checked`
  — none click.
- What assertion 15 genuinely proves is valuable and new: the fold survives the portal
  unmount (`unmounted=true`, `4 compared`, all four labels matching post-toggle values on
  reopen), and — implicitly — the consumers' `$effect` does **not** clobber a manual fold
  when the dialog remounts. That is the `prev === undefined` seeding branch, and it was a
  real hazard.
- The branch that implements SC-1's clause is
  `if (prev !== undefined && prev !== group.visible) setSectionCollapsed(...)`
  (`PublicOverlays.svelte:74-76`, `MyConRuns.svelte:34-36`). Only a genuine ON→OFF flip of
  a master reaches it. Nothing in the probe, and nothing in 70-UAT.md, produces that flip.
- 70-UAT.md's five tests are exactly the five `human_verification` items from the initial
  report. This item lived on the separate `behavior_unverified_items` list and was never
  put to Kurt, so his blanket "everything is looking good" is scoped to what he was shown.

Splitting the truth honestly: the **dim** is a pure derived class and needs no runtime
proof; the **cascade** runs through layer-class bodies that predate the phase and are
corroborated by assertion 16's store↔DOM↔map agreement; only the **collapse-on-master**
transition is unproven. Blast radius if it were broken: the card would simply not
auto-fold. No visibility, data or cascade consequence.

### Requirements Coverage

`.planning/REQUIREMENTS.md` does not exist in this milestone (removed at the v1.9 close),
so DLGS-01..DLGS-06 cannot be checked off against a requirements register. **Re-confirmed
today (`ls` → No such file). Recorded as a known condition, not a phase failure.** They are
traced against the ROADMAP requirement text (ROADMAP.md:718-723), the only authoritative
statement of them.

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| DLGS-01 — shared dialog kit in `dialog-shell/` | 70-01 | ✓ SATISFIED | 6 components + barrel, 375 lines, six consumers. Truths 2, 6, 12 |
| DLGS-02 — Map Layers dialog replaces the hover popover; section order; layer wiring preserved | 70-03, 70-05 | ✓ SATISFIED | Truths 1, 2, 4, 7, 9, 10, 11 — truth 7 now closed live by UAT test 1 |
| DLGS-03 — My Maps rebuilt on the shell | 70-04 | ✓ SATISFIED **(was: ⚠️ PARTIAL)** | Truths 12-20. Truth 17 (footer) closed by PR #1112 |
| DLGS-04 — stutter eliminated: zero native `title=`, no hover-open | 70-03, 70-04, 70-05 | ✓ SATISFIED | Truths 1, 5, 18 |
| DLGS-05 — StravaStrip explicit chips | 70-02 | ✓ SATISFIED **(was: visual read pending)** | Truth 21, closed by UAT test 2 |
| DLGS-06 — autonomous ship + prod verification | 70-06 | ✓ SATISFIED | Eight ship gates (initial pass) + four further build/deploy/probe cycles, each re-queried below |

No ORPHANED requirements.

### DLGS-06 Ship Gates — re-checked

| Gate | Status | Evidence (independently re-run / re-queried by THIS re-verification) |
|------|--------|----------------------------------------------------------------------|
| svelte-check: zero errors on touched files | ✓ VERIFIED | Re-ran `npx svelte-check`: **26 errors, 1 warning in 12 files** (initial pass saw 30 — the count moved DOWN, still inside the documented ~26-30 upstream baseline). Grepping the output for all 11 phase-and-fix paths returns exactly ONE hit, and it is the warning: `dialog-shell/DialogShell.svelte:87:9 Warn: a11y_no_static_element_interactions`. The three other `layer-control/` hits are `extension-api.ts`, `LayerTreeNode.svelte` and `CustomLayers.svelte` — all upstream files with zero diff in this phase or any fix |
| run.gpx webapp vitest not regressed | ✓ VERIFIED (by construction) | `git diff db85b258^ HEAD -- apps/run.gpx/webapp` touches only `VERSION`. Zero Next.js source files. (Local node v22.1.0 is below the 22.12 vitest floor; the empty source diff is the stronger proof) |
| build-frontend.sh clean | ✓ VERIFIED | `gh run view 30587660089` → `Build+Pub(run.gpx) → use1`, **success** — the image build runs it and the bundle is serving |
| PRs squash-merged before release | ✓ VERIFIED | `gh pr view`: #1112 MERGED 16:14:58Z · #1116 MERGED 17:13:12Z · #1120 MERGED 17:54:01Z · #1123 MERGED 22:34:51Z |
| buildpub + deploy dispatched and watched to success | ✓ VERIFIED | `gh run view 30587915173` → `Deploy → us-east-1 (github-hosted) PR:skip`, **success** |
| Roll-verification gate before probing | ✓ VERIFIED | Transcript records 86 of 108 content-hashed chunks replaced vs the pre-deploy set, plus an honest note that the first post-deploy attempt was ABORTED mid-roll while ECS drained the old task and re-run. That is the discipline the gate exists for |
| Post-deploy prod probe green | ✓ VERIFIED | 16/16 against `https://gpx.defcon.run/use1/studio/app`. Independently confirmed to describe the CURRENT bundle: the live entry chunk is `start.CO7vXkJK.js`, byte-identical to the transcript header, and all four phase sentinels are present in the served chunk graph |
| Each new assertion discriminates the old bundle | ✓ VERIFIED | Four separate pre/post pairs, each failing EXACTLY its new assertion: 12/13→13/13 (footer), 13/14→14/14 (scroll), 14/15→15/15 (collapse), 15/16→16/16 (visibility). None is a vacuous green |

### Probe Execution

The phase's probe is a Playwright script targeting live production, not a
`scripts/*/tests/probe-*.sh`. It was NOT re-executed by this re-verification (re-running it
would hit prod with a stubbed session). Instead the committed transcripts were audited for
vacuity and their environmental claims independently re-confirmed by `curl`, `gh` and a
chunk walk.

| Probe | Verification action | Result |
|-------|---------------------|--------|
| `dialog-shell-probe.cjs` (16 assertions) | Read assertions 13-16 in full; grepped the whole file for checkbox/master interactions | Assertions 13, 14, 15, 16 are all non-vacuous and each has a recorded pre-deploy failure. **No assertion clicks a master checkbox** — confirmed by grep, which is what leaves truth 3 open |
| `transcript-fix-{pre,post}-deploy.txt` | Cross-checked against assertion 13's body | 12/13 → 13/13; the FAIL line names the actual defect (`1 "Add run" button(s) on the gate screen`). Genuine discrimination of gap 1 |
| `transcript-scroll-{pre,post}-deploy.txt` | Cross-checked against assertion 14 | 13/14 → 14/14, with measured numbers on both sides (`filler 1400px rendered 336px` → `rendered 1400px`) |
| `transcript-collapse-{pre,post}-deploy.txt` | Cross-checked against assertion 15 | 14/15 → 15/15; the FAIL enumerates three specific label/aria-expanded mismatches |
| `transcript-visibility-{pre,post}-deploy.txt` | Cross-checked against assertion 16 | 15/16 → 16/16; the seed is the OPPOSITE of every built-in default, so it cannot pass vacuously, and the camera half records `moves=0` |

### Anti-Patterns

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `dialog-shell-probe.cjs` | 322-336 | Assertion 4 reports `0 rows inspected` and still PASSes | ℹ️ Info (new) | Three of the five post-deploy runs scored assertion 4 green while inspecting nothing. It went non-vacuous (15 rows) on two runs, so truth 5 stands — but the assertion does not fail closed on an empty set the way assertion 5 names its skips |
| `CloudStorage.svelte` | 409-412 | `finally` still clears `loadingVersions`/`loadingVersionsFileId` unconditionally | ℹ️ Info (downgraded from 🛑) | With overlapping fetches the second submenu can flash "No versions found" before its data lands. Cosmetic only — the keyed buffers make a cross-file render or action impossible |
| `DialogShell.svelte` | 86-87 | `svelte-ignore a11y_mouse_events_have_key_events` names a rule the compiler does not raise here | ⚠️ Warning (carried) | Review WR-03. Still the repo's only warning; the suppression is dead and the intended one never happened |
| `DialogShell.svelte` | 34-37, 90-92 | No `onfocusout` reset; `aria-live` fires on pointer travel; no `aria-describedby` | ⚠️ Warning (carried) | Review WR-02 |
| `BasemapSection.svelte` | 43-51 | `Row`s rendered with no `hint` | ✓ RESOLVED BY DECISION | Kurt accepted this as designed (70-UAT.md test 4). Re-confirmed in source today: still no `hint` prop. Not a gap |
| DialogShell overlay | — | `bg-black/50` dims the map while toggling layers | ✓ RESOLVED BY DECISION | Kurt accepted the centered-modal treatment as shipped (70-UAT.md test 3) |
| `Row.svelte` | 56-59 | `style="background-color: {color}"` interpolates CMS-sourced `m.color` unvalidated | ⚠️ Warning (carried) | Review WR-06. Admin-authored content; a hex-format guard is still worth having |
| `CloudStorage.svelte` | ~690, ~597 | Unkeyed `{#each}` over folders and breadcrumbs alongside rename-in-place state | ⚠️ Warning (carried) | Review WR-07 |
| `Section.svelte` | 84-92 | Master checkbox has no `indeterminate` state | ⚠️ Warning (carried) | Review WR-08 — a partial selection reads as fully OFF |
| `dialog-shell/index.ts` | 2, 9 | `HintBar`/`DEFAULT_HINT` exported but never imported through the barrel; `DEFAULT_HINT` re-declared at `DialogShell.svelte:28` | ℹ️ Info (carried) | Review IN-01 — two sources of truth for the default copy |
| `ShareDialog.svelte` | 366, 399, 412, 426 | Four surviving native `title=` tooltips | ℹ️ Info (carried) | Out of DLGS-04 scope; file untouched by the phase |
| `StravaStrip.svelte` | 406, 441, 657 | Three surviving native `title=` tooltips | ℹ️ Info (new — corrects the initial report) | Pre-existing (the phase's whole StravaStrip diff is 8 lines) and on the strip header / popover chip, not on route or file rows. Outside DLGS-04's stated scope, but the initial report's "zero `title=` across all 8 touched files" was overstated |

**Debt markers:** `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all eleven
phase-and-fix source files — **zero hits**. Re-run today.

### Deferred Items

None.

### Disconfirmation Pass

Three things found by looking specifically for problems rather than for confirmation:

1. **A claim in the initial report that does not hold.** "Source grep for `title=` across
   all 8 touched files: zero hits" is wrong — `StravaStrip.svelte` carries three. They are
   pre-existing and out of DLGS-04's scope, so the requirement still stands, but the
   evidence sentence was too broad and is corrected above.
2. **A green assertion that inspects nothing.** Assertion 4 passed with `0 rows inspected`
   on three of the five post-deploy runs. The headline `16/16` conceals this; only the
   evidence line reveals it. Truth 5 survives on the two non-vacuous runs plus the source
   grep, but the assertion itself should fail closed.
3. **A phase scope line that later work crossed.** ROADMAP's Out-of-scope for Phase 70 says
   "layer data classes"; PR #1123 edited all three. That is post-phase work explicitly
   excluded from this judgment by instruction — recorded so it is visible rather than
   silently absorbed, since anyone reading the roadmap later will see the contradiction.

### Gaps Summary

**There are no gaps.** Both items that produced `gaps_found` on 2026-07-30T14:04:05Z are
closed in the shipped code, each verified by reading the current source and diffing it
against the phase commit, and gap 1 additionally by a probe assertion that fails against
the old bundle and passes against the new one on the live site.

The phase goal is met: two surfaces on one shared dialog kit, hint bar instead of native
tooltips, click-opened dialogs instead of a hover popover — real, wired, and serving in
production at v0.0.108. Three defects found after the initial verification (footer on the
gate screens, a body that crushed rather than scrolled, collapse state resetting on
reopen) were each fixed with a discriminating probe assertion attached, which is why the
probe grew from 12 to 16 assertions and why every one of those four assertions has a
recorded red-then-green pair.

One item remains open and it is not a gap: the master-checkbox → collapse transition of
ROADMAP SC-1 has still never been executed by a test or by a recorded human check. It is a
thirty-second manual check. Until it is done, this phase is `human_needed`, not `passed` —
but nothing about it blocks Phase 71, which consumes the `Section` kit rather than this
mechanism.

---

## Appendix: Initial Verification Findings (2026-07-30T14:04:05Z) — preserved verbatim

Kept so the history is auditable. **These two gaps are CLOSED**; see the re-verification
summary above for how. Nothing here should be re-planned.

### Original gap 1 — status at the time: 🛑 BLOCKER, phase-introduced, live in prod

> **truth:** "The footer shows quiet helper text on the left and the primary Add run button
> on the right (ROADMAP SC-3: 'Add run as the footer primary')"
> **status:** partial
>
> The footer is literally present and correct on the authenticated branch (prod probe
> assertion 11 PASS). But the phase MOVED the Add-run control out of the auth-gated body
> into an unconditional `{#snippet footer()}`, so it now also renders on the sign-in and
> access-denied gate screens where it is a dead end. This is a phase-introduced regression,
> verified by diff against the pre-phase file: at `6fe5cf20` the footer block lived INSIDE
> the `{:else}` branch of the `!$isAuthenticated` / `!$hasGpxStudioAccess` conditional and
> was therefore hidden on both gates. It is live in production as of v0.0.104.
>
> **Artifacts flagged:**
> - `CloudStorage.svelte` lines 993-998 — `{#snippet footer()}` is a sibling of the
>   `{#if !$isAuthenticated} ... {:else if !$hasGpxStudioAccess} ... {:else} ... {/if}`
>   block (lines 581-991), not a child of its `{:else}` arm, so it renders on all three
>   branches. `openAddRun` (lines 566-569) calls `closeCloudStorage()` then
>   `quickStartOpen.set(true)`; `QuickStartHub.svelte:62` gates its entire render on
>   `canShow = $isAuthenticated && $hasGpxStudioAccess` — the same two conditions that
>   produced the gate screen. On both gates the click therefore closes My Maps, opens
>   nothing, and removes the Sign In button from view.
> - `DialogShell.svelte` lines 80-88 — renders `{#if footer}` with no awareness of body
>   state; there is no `showFooter` prop.
> - `QuickStartHub.svelte` line 48 — `quickStartOpen.subscribe(...)`, the handler that
>   resets the store to `false`, only runs while the hub is mounted, and the hub is not
>   mounted when `canShow` is false. The store is left latched `true` after a gate-screen
>   click.
>
> **Missing:**
> - Gate the footer snippet body on `$isAuthenticated && $hasGpxStudioAccess` at the
>   CloudStorage call site (or add a `showFooter` prop to DialogShell and pass the same
>   expression).
> - Make `openAddRun` a no-op when `!$isAuthenticated || !$hasGpxStudioAccess` so
>   `quickStartOpen` is never latched true with no consumer mounted.
> - Add a probe assertion covering the unauthenticated My Maps branch — the existing probe
>   stubs a session with `services: ['gpxstudio']`, so the 12/12 green never touches either
>   gate screen.

**All three remedies landed.** The footer is gated at the call site *as a prop* (the
stronger of the two options, since it drops the chrome row too), `openAddRun` early-returns,
and probe assertion 13 covers the access-denied gate with a recorded pre-deploy failure.

### Original gap 2 — status at the time: 🛑 BLOCKER-class defect, but NOT this phase's doing

> **truth:** "Version history stays available when a file has more than one version
> (plan 04) — and reads that file's versions"
> **status:** partial
>
> PRE-EXISTING defect carried into the new UI, NOT introduced by this phase.
> `fetchVersionHistory` (lines 382-398) is byte-identical to its pre-phase form at
> `6fe5cf20` (lines 355-371), as is the
> `{#if loadingVersions && loadingVersionsFileId === file.fileId}` render guard. The
> submenu is available and works on the happy path, so the plan's literal must-have holds.
> Recorded as a gap rather than a clean pass because the phase changed the control's
> EXPOSURE: the trigger moved from a dedicated click-only `DropdownMenu.Root` to a bits-ui
> `DropdownMenu.Sub`, whose SubTrigger opens on pointer-enter, so the fetch can now fire on
> incidental pointer travel down the row's overflow menu.
>
> **Artifact flagged:** `CloudStorage.svelte` — `fileVersions` (line 114) is a single
> module-level buffer shared by every file row and is never reset before a fetch;
> `loadingVersionsFileId` is cleared in `finally` (line 396) by whichever request settles
> first. A failed fetch leaves the previous file's versions in the buffer, and an
> overlapping fetch clears the loading guard early — either way file B's submenu can render
> (and, via `handleLoadVersion(file, ver.version)` at line 918, ACTION) file A's version
> list.
>
> **Missing:**
> - Reset `fileVersions = []` and `versionHistoryCurrent = 1` at the top of
>   `fetchVersionHistory`, before the await.
> - Guard the `finally` block so it only clears `loadingVersions`/`loadingVersionsFileId`
>   when `loadingVersionsFileId === file.fileId` (stale-response discard), or key the buffer
>   by fileId.

**Closed via the second remedy** — the buffers are keyed by fileId, which subsumes the
first remedy (the per-file entry is cleared before the await) and makes the `finally` guard
unnecessary for correctness. The unguarded `finally` survives as a cosmetic flicker only,
recorded in the anti-patterns table.

### Original human-verification items (all five now passed — 70-UAT.md)

| # | Item | Outcome |
|---|------|---------|
| 1 | Six-section order with real signed-in data | ✓ passed — closes truth 7's live gap |
| 2 | Strava card chip states | ✓ passed — closes truth 21's visual read |
| 3 | Modal `bg-black/50` dimming while toggling layers | ✓ accepted as designed |
| 4 | Hint bar reading default copy on un-hinted rows | ✓ accepted as designed; `BasemapSection` still passes no `hint` |
| 5 | My Maps gate screens | ✓ passed — user-side confirmation of the gap 1 fix |

### Original ship-gate and probe audit

The initial report's eight ship gates, its assertion-6 repair analysis (judged a legitimate
strengthening, not a weakened probe), and its key-link table all stood up when re-queried
today; the one link that read `⚠️ PARTIAL` — `CloudStorage` footer `Add run` → `QuickStartHub` —
is now `✓ WIRED`, since the control can no longer paint on a screen where it would be a dead
end.

---

_Initial verification: 2026-07-30T14:04:05Z — status `gaps_found`, 19/21_
_Re-verified: 2026-07-30T22:54:12Z — status `human_needed`, 20/21_
_Verifier: Claude (gsd-verifier)_
