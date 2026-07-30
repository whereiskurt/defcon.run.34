---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
verified: 2026-07-30T14:04:05Z
status: gaps_found
score: 19/21 must-haves verified
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "The footer shows quiet helper text on the left and the primary Add run button on the right (ROADMAP SC-3: 'Add run as the footer primary')"
    status: partial
    reason: >-
      The footer is literally present and correct on the authenticated branch (prod probe
      assertion 11 PASS). But the phase MOVED the Add-run control out of the auth-gated
      body into an unconditional `{#snippet footer()}`, so it now also renders on the
      sign-in and access-denied gate screens where it is a dead end. This is a
      phase-introduced regression, verified by diff against the pre-phase file: at
      6fe5cf20 the footer block lived INSIDE the `{:else}` branch of the
      `!$isAuthenticated` / `!$hasGpxStudioAccess` conditional and was therefore hidden
      on both gates. It is live in production as of v0.0.104.
    artifacts:
      - path: "apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte"
        issue: >-
          Lines 993-998 `{#snippet footer()}` is a sibling of the `{#if !$isAuthenticated}
          ... {:else if !$hasGpxStudioAccess} ... {:else} ... {/if}` block (lines 581-991),
          not a child of its `{:else}` arm, so it renders on all three branches.
          `openAddRun` (lines 566-569) calls `closeCloudStorage()` then
          `quickStartOpen.set(true)`; QuickStartHub.svelte:62 gates its entire render on
          `canShow = $isAuthenticated && $hasGpxStudioAccess` — the same two conditions
          that produced the gate screen. On both gates the click therefore closes My Maps,
          opens nothing, and removes the Sign In button from view.
      - path: "apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte"
        issue: >-
          Lines 80-88 render `{#if footer}` with no awareness of body state; there is no
          `showFooter` prop, so the shell cannot express "footer only when the body is the
          real content".
      - path: "apps/run.gpx/gpx-studio/website/src/lib/components/QuickStartHub.svelte"
        issue: >-
          Line 48 `quickStartOpen.subscribe(...)` — the handler that resets the store to
          `false` only runs while the hub is mounted, and the hub is not mounted when
          `canShow` is false. The store is left latched `true` after a gate-screen click.
    missing:
      - "Gate the footer snippet body on `$isAuthenticated && $hasGpxStudioAccess` at the CloudStorage call site (or add a `showFooter` prop to DialogShell and pass the same expression)."
      - "Make `openAddRun` a no-op when `!$isAuthenticated || !$hasGpxStudioAccess` so `quickStartOpen` is never latched true with no consumer mounted."
      - "Add a probe assertion covering the unauthenticated My Maps branch — the existing probe stubs a session with `services: ['gpxstudio']`, so the 12/12 green never touches either gate screen."
  - truth: "Version history stays available when a file has more than one version (plan 04) — and reads that file's versions"
    status: partial
    reason: >-
      PRE-EXISTING defect carried into the new UI, NOT introduced by this phase.
      `fetchVersionHistory` (lines 382-398) is byte-identical to its pre-phase form at
      6fe5cf20 (lines 355-371), as is the `{#if loadingVersions && loadingVersionsFileId
      === file.fileId}` render guard. The submenu is available and works on the happy
      path, so the plan's literal must-have holds. Recorded as a gap rather than a clean
      pass because the phase changed the control's EXPOSURE: the trigger moved from a
      dedicated click-only `DropdownMenu.Root` to a bits-ui `DropdownMenu.Sub`, whose
      SubTrigger opens on pointer-enter, so the fetch can now fire on incidental pointer
      travel down the row's overflow menu.
    artifacts:
      - path: "apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte"
        issue: >-
          `fileVersions` (line 114) is a single module-level buffer shared by every file
          row and is never reset before a fetch; `loadingVersionsFileId` is cleared in
          `finally` (line 396) by whichever request settles first. A failed fetch leaves
          the previous file's versions in the buffer, and an overlapping fetch clears the
          loading guard early — either way file B's submenu can render (and, via
          `handleLoadVersion(file, ver.version)` at line 918, ACTION) file A's version
          list.
    missing:
      - "Reset `fileVersions = []` and `versionHistoryCurrent = 1` at the top of `fetchVersionHistory`, before the await."
      - "Guard the `finally` block so it only clears `loadingVersions`/`loadingVersionsFileId` when `loadingVersionsFileId === file.fileId` (stale-response discard), or key the buffer by fileId."
behavior_unverified_items:
  - truth: "Turning a group's master checkbox off collapses and dims that group and cascades OFF to its child rows, exactly as it does today"
    test: >-
      Signed in on https://gpx.defcon.run/use1/studio/app, open Map Layers. Expand DEF CON
      34 ROUTES and turn several route rows ON. Uncheck the section's master checkbox
      (rightmost in the header). Then re-check it. Repeat on USER CHECK-INS, on MY DEF CON
      RUNS (whose section-wide master fans out across every con-day sub-section), and on
      COMMUNITY ROUTES.
    expected: >-
      Master OFF collapses the section, dims its uppercase label to ~55% opacity, and
      turns every child row off on the map. Master ON re-expands and restores them. After
      either transition the chevron still folds/unfolds the section freely without the
      effect fighting it. The MY DEF CON RUNS master must NOT fire a fitBounds per con day
      (it passes `fit = false`).
    why_human: >-
      This is a rewritten state machine, not preserved code. The collapse now flows through
      new bookkeeping (`prevGroupVisible` / `prevCheckinsVisible` plain-object effects in
      PublicOverlays.svelte:48-67 and MyConRuns.svelte:17-25) into the shared `Section`'s
      `collapsed` prop, and the dimming is a new `master === false ? 'opacity-55' : ''`
      class in Section.svelte:68-71. gpx-studio has no test runner, and the production
      Playwright probe never toggles a single checkbox — all 12 assertions are read-only
      (presence, DOM order, attribute counts, hover/Esc). Presence and wiring are proven;
      the transition itself is not.
deferred: []
human_verification:
  - test: >-
      Sign in with a real account that has con-day-assigned runs and at least one published
      community route, then open Map Layers.
    expected: >-
      MY DEF CON RUNS renders after the DEF CON 34 / RABBIT route groups, and COMMUNITY
      ROUTES renders last — completing the six-section order contract.
    why_human: >-
      The prod probe stubs `**/use1/api/gpx/**` to `{}`, so both manifests came back empty
      and neither section rendered. Probe assertion 5 passed while explicitly skipping
      them ("skipped: no My DEF CON Runs / Community Routes in prod data"), so 4 of the 6
      ordered sections were actually exercised live. Source order in
      LayerControl.svelte:495-503 is correct; only the live rendering is unconfirmed.
  - test: >-
      Open the Strava strip with an account that has (a) a tagged import, (b) an
      imported-but-untagged activity, and (c) a never-imported activity. Click each card.
    expected: >-
      Tagged = dimmed/disabled with "✓ <weekday>"; imported-untagged = amber "Pick a day"
      chip opening the popover in 'assign' mode; never-imported = quiet "+ Import" chip
      opening it in 'import' mode.
    why_human: >-
      "Reads as actionable or done" (ROADMAP SC-4) is a visual judgment. The production
      probe has ZERO Strava assertions — it stubs the session with `hasStrava: false`
      (dialog-shell-probe.cjs:128) — which contradicts 70-02-SUMMARY.md:122's claim that
      "visual confirmation of the three chip states is deferred to the Playwright prod
      probe in plan 06". Source is verified (copy correct, `isTagged`/`isUntaggedImport`/
      `openPopover` byte-identical to pre-phase); the visual read is not.
  - test: >-
      With Map Layers open, try to pan and zoom the map while toggling route rows on and
      off, on desktop and on a phone.
    expected: >-
      Kurt confirms the modal treatment is acceptable in practice.
    why_human: >-
      The dialog is a focus-trapping modal with a full-viewport `bg-black/50` overlay
      (bits-ui `Dialog.Content` always renders `Dialog.Overlay`), so unlike the old
      anchored popover the map is dimmed and non-interactive while layers are being
      toggled (review WR-05). Centered modals were the user's explicit sketch-checkpoint
      choice, so this is by design — but the dimming consequence was not part of that
      decision and is a subjective call.
  - test: >-
      Open Map Layers and hover a basemap radio row, then a per-day sub-header under MY DEF
      CON RUNS, then a folder/day header in My Maps.
    expected: >-
      Kurt decides whether the hint bar showing the default "Hover a row for details" while
      the user is literally hovering a row is acceptable for these rows.
    why_human: >-
      Review WR-04, independently confirmed: `BasemapSection.svelte:43-51` passes no `hint`
      to its `Row`s, and `Section` puts `data-hint` only on the header (a sibling of the
      children wrapper, not an ancestor), so `closest('[data-hint]')` resolves to null.
      Related: on dialog open the bar reads the focus-trapped element's hint ("Choose the
      background map style.") rather than the default copy — see probe assertion 6's
      evidence line. UI-SPEC §3 (default copy) and §7 (focusin) genuinely conflict in the
      open state; the executor resolved it toward §7. Cosmetic and subjective.
  - test: >-
      Open My Maps signed OUT, and again with an account lacking the gpxstudio service.
    expected: >-
      The gate screen shows only its own message and (when signed out) the Sign In button.
    why_human: >-
      Confirms the CR-02 gap above from the user side and gives Kurt the live look before
      the fix lands. Currently the filled primary "Add run" button is the most prominent
      control on both gate screens and is a dead end.
---

# Phase 70: gpx-studio Shared Dialog Shell (Map Layers + My Maps) — Verification Report

**Phase Goal:** Replace the hover-opened layers popover and the icon-strip My Maps dialog
with two centered dialogs built from ONE shared component kit; presentation-layer only,
all layer/data wiring untouched; fully autonomous delivery through a live prod probe.

**Verified:** 2026-07-30T14:04:05Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Ship state:** already merged (PR #1098 → `db85b258`) and deployed (v0.0.104, use1). No
deploy, merge, or workflow dispatch was performed by this verification.

## Goal Achievement

The structural goal is achieved and live. Both surfaces genuinely run on one kit
(`dialog-shell/`, 6 components, all 5 consumer files import through `index.js`), the
hover-open wiring is deleted, every native `title=` on a route/file row is gone, and a
production Playwright probe confirms it on the real site. Two defects sit inside the
delivered surfaces — one a phase-introduced regression, one a pre-existing bug carried
into a more exposed position — so the phase does not close clean.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking the layers control opens a centered "Map Layers" dialog; it never opens on hover and never closes on mouse-leave | ✓ VERIFIED | Prod probe assertions 2 (hover → 0 dialogs) and 3 (click → visible `role=dialog`). Source: `LayerControl.svelte:449-461` is a plain `<button onclick={() => (open = true)}>`. Diff vs `6fe5cf20` shows `onmouseenter`/`onmouseleave`/`onpointerenter`, the 500ms `cancelEvents` re-entry guard, `openLayerControl`/`closeLayerControl`, `container`, and the `svelte:window` `composedPath` handler all DELETED. Grep for those tokens across all 6 touched components: zero hits. |
| 2 | Every section renders through ONE shared `Section` card — a single rotating-chevron collapse affordance (no icon node swap), uppercase tracked label, count badge, master checkbox rightmost | ✓ VERIFIED | `Section.svelte:45-92` — one `<ChevronDown>` with a `-rotate-90` class toggle, then trailing controls in fixed order count (78-80) → `menu` (82) → master (84-92). All 5 consumers import `Section` from the barrel; no component hand-rolls a header. |
| 3 | Turning a group's master checkbox off collapses and dims that group and cascades OFF to its child rows, exactly as today | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Code present and wired (`PublicOverlays.svelte:48-67`, `MyConRuns.svelte:17-38`, `CommunityRoutes.svelte:19-22`, dimming at `Section.svelte:68-71`) but this is REWRITTEN state-machine code, not preserved code. No test runner exists in gpx-studio and the prod probe never toggles a checkbox — all 12 assertions are read-only. See `behavior_unverified_items`. |
| 4 | Basemap switching, per-route toggles and check-in filters still drive the map identically | ✓ VERIFIED | Payload-level diff proof: `setAggregateVisible`/`setCheckInsVisible`/`setGroupVisible`/`setRouteVisible` moved from `e.currentTarget.checked` to the kit's `v` callback (same boolean); `setCheckInFilters` payloads `{window}`, `{match}`, `{runner: null}` unchanged; `toggleType` not in the diff at all. The layer classes (`public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`) are untouched by the phase commit. |
| 5 | Zero native `title=` tooltips on route/file rows; descriptions travel via `data-hint` | ✓ VERIFIED | Prod probe assertion 4 (15 layer rows, `[data-layer-row] [title]` = 0 and `[data-layer-row][title]` = 0) and assertion 12 (2 file rows, same for `[data-file-row]`). Source grep for `title=` across all 8 touched files: zero hits. Pre-phase `CloudStorage.svelte` had `title="Delete"`; it is gone. |
| 6 | Hovering or keyboard-focusing a hinted element updates the hint bar; leaving restores the default copy | ✓ VERIFIED | Prod probe assertion 7 — hint bar text became the real CMS description "All four classics - North, East, South, West - stitched into one 20K epic." Assertion 6 — after neutralising hover AND focus the bar returns to "Hover a row for details". Source: `DialogShell.svelte:34-37, 70-78` delegates `onmouseover` + `onfocusin` through `closest('[data-hint]')`. Caveats: no `onfocusout` reset, and unhinted rows fall through to the default copy (see human items). |
| 7 | Map Layers section order is BASEMAP → USER CHECK-INS → route groups → MY DEF CON RUNS → COMMUNITY ROUTES; empty sections hidden | ✓ VERIFIED (partially exercised live) | Source: `LayerControl.svelte:475-503` renders `BasemapSection` → conditional Overlays → `PublicOverlays` → `MyConRuns` → `CommunityRoutes`, each behind its own `{#if}` length guard. Prod probe assertion 5 confirmed `[Basemap \| User Check-ins \| DEF CON 34 Routes \| Rabbit Routes]` — the last two sections had no prod data and were skipped. Human item raised. |
| 8 | Esc and overlay click close the dialog and focus returns to the layers button | ✓ VERIFIED | Prod probe assertion 8 (Escape closes). Focus return: `LayerControl.svelte:469-472` `onOpenChange` calls `layersBtn?.focus()` on close, with `bind:this={layersBtn}` at line 452. |
| 9 | Every layer instance created in `map.onLoad`, the async-auth loads, the day-assign popup bridge and the run-reload subscription behave exactly as before | ✓ VERIFIED | Diff proof — the entire `map.onLoad` block (lines 244-339), the `onMount` `dc34-open-day-assign` bridge with its cleanup (349-381), `quickStartAction` (404-416) and `myConRunsRefresh` (429-441) subscriptions produce ZERO `+`/`-` lines in `git diff db85b258^ db85b258` for this file. Only obsolete popover plumbing and two comment rewordings changed. |
| 10 | QuickStart hub `routes` / `runners` still reveal their layers and open the dialog | ✓ VERIFIED | `LayerControl.svelte:404-416` is byte-identical in the diff; `open = true` now drives the DialogShell, which probe assertion 3 proved is the dialog's open state. |
| 11 | `LayerTree.svelte` is NOT modified — it still serves the overlays tree and LayerControlSettings | ✓ VERIFIED | `git diff --stat` for `LayerTree.svelte`, `LayerTreeNode.svelte`, `LayerControlSettings.svelte` is empty. `flattenLayerTree` keeps the recursive walk in `basemap-tree-pure.ts` (33 lines, dependency-free), consumed only by `BasemapSection.svelte:18`. |
| 12 | My Maps opens as the shared 420px shell: cloud glyph, heading, breadcrumb-aware subheading, scrollable carded body, footer, hint bar | ✓ VERIFIED | `CloudStorage.svelte:572-579` — `DialogShell dialogId="mymaps" heading="My Maps"` with `subheading` derived from `$breadcrumbs`; shell width `!max-w-[420px]` at `DialogShell.svelte:43`. Prod probe assertion 9 opened it via Ctrl+O. |
| 13 | MY FILES precedes SHARED WITH YOU in DOM order | ✓ VERIFIED | Prod probe assertion 10 — `[My files \| Other maps \| Shared with you]`, against a stubbed session carrying 1 file and 1 global folder. Source: `CloudStorage.svelte:619` (My files) precedes `:963` (Shared with you). |
| 14 | The MY FILES header overflow menu houses New folder, Refresh and Export all — the floating top-right icon pair is gone | ✓ VERIFIED | `CloudStorage.svelte:625-653` `{#snippet menu()}` with exactly those three `DropdownMenu.Item`s. The pre-phase toolbar `<div>` holding the icon pair is absent from the current file. |
| 15 | Each file row shows ONE labelled Edit button plus an overflow menu with Share, Assign day, Save as Route, Export GPX and a red separated Delete; version history available when a file has >1 version | ✓ VERIFIED (defect noted) | `CloudStorage.svelte:846-945` — labelled `Edit` button then `DropdownMenu` with all five items, `DropdownMenu.Separator` then `variant="destructive"` Delete, and the `{#if (file.versionCount \|\| 1) > 1}` version-history `Sub`. Availability holds; correctness of WHICH versions render is the second gap (CR-01, pre-existing). |
| 16 | Row actions fade in on hover or keyboard focus on pointer devices and are always visible on touch viewports | ✓ VERIFIED | `CloudStorage.svelte:843` (file rows) and `:736` (folder rows): `opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100`. |
| 17 | The footer shows quiet helper text on the left and the primary Add run button on the right, with the hint bar below it | ✗ FAILED | Present and correct on the authenticated branch (prod probe assertion 11). But the phase moved it out of the auth-gated body into an unconditional `{#snippet footer()}`, so it also renders on the sign-in and access-denied gates where the CTA is a dead end that latches `quickStartOpen`. Pre-phase (`6fe5cf20`) the footer was inside the `{:else}` arm and was correctly hidden. **BLOCKER — phase-introduced regression, live in prod.** |
| 18 | No file row, folder row or action control carries a native tooltip attribute | ✓ VERIFIED | Prod probe assertion 12 (2 rows, 0 `title`). Source grep: zero `title=` in `CloudStorage.svelte`. |
| 19 | `CloudStorage` stays a LEGACY-mode component (plain `let` + `$:` only, zero runes) | ✓ VERIFIED | `grep '\$state\|\$derived\|\$effect\|\$props\|\$bindable' CloudStorage.svelte` → exit 1, zero matches, across all 1051 lines. Its ~30 reactive bindings are intact. |
| 20 | `handleExportFile` reuses `loadFromCloud` + FileSaver — no presigned URL or storage key reaches the DOM; every row-action wrapper keeps `onclick` stopPropagation | ✓ VERIFIED | `CloudStorage.svelte:365-379` builds the Blob client-side from the same authenticated endpoint the row click uses. Three `onclick={(e) => e.stopPropagation()}` wrappers at lines 700, 737 and 844. |
| 21 | StravaStrip: imported-untagged shows an actionable "Pick a day"; never-imported shows a quiet "+ Import"; tagged unchanged; popover modes unchanged | ✓ VERIFIED | `StravaStrip.svelte:570-587` three-branch `{#if tagged}{:else if untaggedImport}{:else}`; copy changed from "Assign a day" → "Pick a day" and the `+ Import` branch is new. `isTagged` (192-194), `isUntaggedImport` (196-198) and `openPopover` (203-213) are byte-identical to `6fe5cf20`; the whole file diff is 8 changed lines. Visual "reads as actionable" → human item. |

**Score:** 19/21 truths verified (1 failed, 1 present but behavior-unverified)

### DLGS-06 Ship Gates

| Gate | Status | Evidence (independently re-run / re-queried by this verification) |
|------|--------|-------------------------------------------------------------------|
| svelte-check: zero errors on touched files | ✓ VERIFIED | Re-ran `npx svelte-check` in `apps/run.gpx/gpx-studio/website`: **30 errors, 1 warning in 16 files**. Grepping the saved output for all 9 phase-touched paths returns exactly ONE hit — and it is the *warning*, not an error: `dialog-shell/DialogShell.svelte:70:9 Warn: a11y_no_static_element_interactions`. Zero errors in touched files. Note: 70-REVIEW.md says "26 errors"; the actual count is 30, inside the CONTEXT's documented ~26-30 upstream baseline. |
| run.gpx webapp vitest not regressed | ✓ VERIFIED (by construction) | `git diff --stat db85b258^ db85b258 -- apps/run.gpx/webapp` is EMPTY. The phase touched zero Next.js webapp files, so the suite cannot have regressed from it. (Local node is v22.1.0, below the 22.12 vitest floor, so the suite was not re-run — the empty diff is the stronger proof.) |
| build-frontend.sh clean | ✓ VERIFIED | buildpub run `30518519521` conclusion `success` (`gh run view`) — the image build runs `build-frontend.sh`; the resulting bundle is serving in prod. |
| Squash-merged to main, MERGED confirmed before release | ✓ VERIFIED | `gh pr view 1098` → `state: MERGED`, `mergedAt: 2026-07-30T06:04:57Z`, `mergeCommit: db85b258a0087c46f9171a465b76c05c158c267e`. |
| buildpub + deploy dispatched and watched to success | ✓ VERIFIED | `gh run view 30518519521` → `Build+Pub(run.gpx) → use1`, success. `gh run view 30518808844` → `Deploy → us-east-1 (github-hosted) PR:skip`, success. |
| Roll-verification gate before probing | ✓ VERIFIED | Transcript roll-gate line: sentinel `data-dc34-layers-btn` found in `chunks/Cj35SVFZ.js` on attempt 1/12, 36 chunks walked. Independently re-confirmed today — see Behavioral Spot-Checks. |
| Post-deploy prod probe green | ✓ VERIFIED | `transcript-post-deploy.txt`: RESULT 12/12, against `https://gpx.defcon.run/use1/studio/app`, v0.0.104. |
| Pre-deploy probe discriminates old bundle | ✓ VERIFIED | `transcript-pre-deploy.txt`: 4/12. All 8 new-UI assertions FAIL; the 4 "passes" are vacuous (0 rows inspected ×2, skipped hint element, no-op Escape). The probe genuinely discriminates. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `dialog-shell/index.ts` | 5 consumer components | barrel import `$lib/components/dialog-shell/index.js` | ✓ WIRED — PublicOverlays, MyConRuns, CommunityRoutes, BasemapSection, LayerControl, CloudStorage all import through it; no relative-path bypass |
| `DialogShell` | `HintBar` | composes it and owns the delegated `onmouseover`/`onfocusin` on `[data-dialog-body]` | ✓ WIRED (`DialogShell.svelte:3, 70-78, 90`) |
| `DialogShell` | prod probe | forwards `dialogId` to `Dialog.Content` as `data-dc34-dialog` | ✓ WIRED — probe selects `[data-dc34-dialog="layers"]` / `"mymaps"` and both resolved live |
| `Section` | consumers' master-visibility effects | `collapsed` input prop + `ontoggle` callback (deliberately not bindable) | ✓ WIRED — all 6 call sites pass both |
| `LayerControl` `CustomControl` | dialog | dialog rendered as a SIBLING of `CustomControl`, portals to `<body>` | ✓ WIRED (`LayerControl.svelte:449-461` then `465-505`) |
| `Row` | prod probe | `data-layer-row` on every row | ✓ WIRED — 15 rows counted live |
| `CloudStorage` footer `Add run` | `QuickStartHub` | `quickStartOpen.set(true)` | ⚠️ PARTIAL — wired and functional when authenticated; a dead end on both gate branches (gap 1) |
| `handleExportFile` | `loadFromCloud` + FileSaver | authenticated fetch → client-side Blob | ✓ WIRED |
| Header text props | phase-wide zero-tooltip grep | named `heading`/`subheading`, never after the native attribute | ✓ WIRED — the source grep for `title=` returns zero across all touched files, so the naming guard held |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| svelte-check errors in phase-touched files | `npx svelte-check` then grep 9 paths | 30 errors total, 0 in touched files (1 warning in DialogShell) | ✓ PASS |
| Phase code is actually serving in prod | curl `/use1/studio/app`, walk all 105 referenced JS chunks | `data-dc34-layers-btn` FOUND, `Hover a row for details` FOUND | ✓ PASS |
| My Maps strings in the initial chunk graph | same walk for `GPX up to 10mb`, `Your DEF CON run folder`, `Pick a day`, `Save as Route` | NOT FOUND in the 105 preloaded chunks | ? INCONCLUSIVE — CloudStorage/StravaStrip ship in lazily-imported chunks not referenced by the entry HTML. Not a negative result. Prod probe assertions 9-12 (which trigger the dynamic import at runtime) are the authoritative evidence for My Maps. |
| Ship artifacts real | `gh run view` ×2, `gh pr view` ×2 | both runs `success`; PR #1098 MERGED as `db85b258`; PR #1104 OPEN | ✓ PASS |
| Debt markers in phase source | grep `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` across the 9 touched files | zero hits | ✓ PASS |

### Probe Execution

The phase's probe is a Playwright script, not a `scripts/*/tests/probe-*.sh`, and it
targets **live production**. It was NOT re-executed by this verification (re-running it
would hit prod with a stubbed session and is explicitly out of scope per the ship-state
instruction). Instead the committed transcripts were audited for internal honesty and
their environmental claims were independently re-confirmed:

| Probe | Verification action | Result |
|-------|---------------------|--------|
| `70-06-probes/dialog-shell-probe.cjs` | Read all 12 assertions; checked each for vacuity | Non-vacuous. Assertions 4/12 report inspected row counts (15 / 2) rather than passing on an empty set; assertion 5 names its skipped sections; assertion 3 checks `role === 'dialog'` not mere visibility. |
| `transcript-pre-deploy.txt` | Cross-checked against the assertion bodies | 4/12; every new-UI assertion fails. Genuine discrimination. |
| `transcript-post-deploy.txt` | Cross-checked; re-confirmed the bundle claim by curl | 12/12; sentinel strings confirmed still served today. |
| `transcript-post-deploy-run1-11of12.txt` | Audited the mid-run assertion repair | See below — repair judged legitimate. |

**On the assertion-6 repair (known condition 2): I agree it was a correct call, not a
weakened probe.** Three reasons, all checked against the code rather than the narrative:

1. The original assertion was testing an impossible state. `DialogShell` wires the hint
   bar to `onfocusin` (UI-SPEC §7 requires it), and bits-ui's `Dialog.Content` traps focus
   into the dialog on open. The first focusable descendant is inside the Basemap section
   header, which carries `data-hint="Choose the background map style."`. So at open the
   bar can only read that hint. The UI is right; the assertion encoded a spec conflict
   (§3's default copy vs §7's focusin) as a requirement.
2. The repair asserts the **same literal** (`DEFAULT_HINT`), not a relaxed one, and it
   neutralises hover (`page.mouse.move(5,5)`) and focus (focus a non-`[data-hint]`
   descendant) rather than skipping the check.
3. It is arguably a **stronger** assertion than the original: proving the bar can RETURN
   to the default exercises the `onmouseleave` / unhinted-`focusin` restore paths, which
   "initialised to the default" never would. The evidence line still records the on-open
   value for audit, and run 1 is committed.

The one thing to keep visible: mid-run assertion repair is exactly the manoeuvre that
turns a red probe green. It was handled correctly here (run 1 preserved, reason tied to a
specific UI-SPEC clause, literal unchanged), and that discipline is what makes it
acceptable.

### Requirements Coverage

`.planning/REQUIREMENTS.md` does not exist in this milestone (removed at the v1.9 close),
so DLGS-01..DLGS-06 cannot be checked off against a requirements register. **Recorded as a
known condition, not a phase failure.** They are traced instead against the ROADMAP
requirement text (ROADMAP.md:718-723), which is the only authoritative statement of them.

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| DLGS-01 — shared dialog kit in `dialog-shell/` | 70-01 | ✓ SATISFIED | 6 components + barrel, 358 lines total, all wired into 5 consumers. Truths 2, 6, 12 |
| DLGS-02 — Map Layers dialog replaces the hover popover; section order; layer wiring preserved | 70-03, 70-05 | ✓ SATISFIED | Truths 1, 2, 4, 7, 9, 10, 11 |
| DLGS-03 — My Maps rebuilt on the shell | 70-04 | ⚠️ PARTIAL | Truths 12-16, 18-20 all hold; truth 17 (footer) FAILED on the two gate branches |
| DLGS-04 — stutter eliminated: zero native `title=`, no hover-open | 70-03, 70-04, 70-05 | ✓ SATISFIED | Truths 1, 5, 18 — prod-verified on 17 live rows |
| DLGS-05 — StravaStrip explicit chips | 70-02 | ✓ SATISFIED (visual read pending) | Truth 21. Note the SUMMARY's claim that the prod probe would confirm the chip states is not borne out — the probe has no Strava assertions |
| DLGS-06 — autonomous ship + prod verification | 70-06 | ✓ SATISFIED | All 8 ship gates above, each independently re-queried |

No ORPHANED requirements: ROADMAP lists exactly DLGS-01..DLGS-06 and every one is claimed
by a plan's `requirements:` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `CloudStorage.svelte` | 993-998 | Primary CTA rendered outside the auth conditional that gates its target | 🛑 Blocker | Gap 1 — live dead-end control on both gate screens |
| `CloudStorage.svelte` | 114, 382-398 | Shared mutable buffer with no reset and a `finally` that clears the guard unconditionally | 🛑 Blocker (pre-existing) | Gap 2 — cross-file version list render/action |
| `DialogShell.svelte` | 69-70 | Dead `svelte-ignore` naming a rule the compiler does not raise here | ⚠️ Warning | Review WR-03. Independently confirmed: the live warning is `a11y_no_static_element_interactions`, and it is the repo's ONLY warning — so the suppression is dead code AND the intended suppression never happened |
| `DialogShell.svelte` | 34-37, 70-78 | No `onfocusout` reset; `aria-live` fires on pointer travel; no `aria-describedby` from control to hint | ⚠️ Warning | Review WR-02. Tabbing out of the body strands the last row's hint |
| `BasemapSection.svelte` | 43-51 | `Row`s rendered with no `hint`; `Section` puts `data-hint` on the header only, a sibling of the children wrapper | ⚠️ Warning | Review WR-04. Hovering a basemap row prints "Hover a row for details" — same dead-end for MyConRuns day sub-headers and CloudStorage day headers |
| `Row.svelte` | 56-59 | `style="background-color: {color}"` interpolates CMS-sourced `m.color` unvalidated | ⚠️ Warning | Review WR-06. Svelte escapes quotes so the attribute cannot be broken out of, but additional CSS declarations can be injected. Admin-authored CMS content, so low severity — worth a hex-format guard |
| `CloudStorage.svelte` | 690, 597 | Unkeyed `{#each}` over folders and breadcrumbs alongside rename-in-place state | ⚠️ Warning | Review WR-07. Index-keyed reconciliation can strand `editingFolderId` on the wrong row after a refresh |
| `Section.svelte` | 84-92 | Master checkbox has no `indeterminate` state | ⚠️ Warning | Review WR-08. `allDaysVisible`/`allVisible` use `.every(...)`, so a partial selection reads as fully OFF |
| `dialog-shell/index.ts` | 2, 9 | `HintBar` and `DEFAULT_HINT` exported but never imported through the barrel; `DEFAULT_HINT` re-declared as a literal in `DialogShell.svelte:28` | ℹ️ Info | Review IN-01. Two sources of truth for the default copy — the probe asserts the literal, so drift would silently pass source review and fail the probe |
| `ShareDialog.svelte` | 366, 399, 412, 426 | Four surviving native `title=` tooltips | ℹ️ Info | Out of DLGS-04 scope (that requirement covers route/file ROWS) and the file is untouched by the phase — but the "nothing floats over the list, ever" principle stops at this dialog's boundary |
| `70-REVIEW.md` | byte 26592 | Literal NUL byte inside a suggested regex, making the file classify as binary (`file` → `data`, plain `grep` silently matches nothing) | ℹ️ Info | Documentation artifact only. Anyone grepping the review without `-a` gets zero results and may conclude it is empty |

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`) exist in any phase-touched source file.

### Deferred Items

None. Phase 71 consumes the Phase 70 `Section` kit for a HEAT MAP section but addresses
none of the defects above. `.planning/` contains no scheduled follow-up for either gap;
PR #1104 is evidence-only (post-deploy transcript + code review), carrying no fixes.

### Disconfirmation Pass

Per the Confirmation Bias Counter, three things found by looking specifically for them
rather than for confirmation:

1. **A requirement only partially met.** ROADMAP SC-1 says "a dialog whose **six** sections
   all share one collapse affordance". Only four sections ever rendered during the live
   probe; MY DEF CON RUNS and COMMUNITY ROUTES have never been observed in the new shell
   outside a dev environment.
2. **A check that passes without testing its stated behaviour.** Probe assertion 5 —
   "Map Layers section order follows the spec" — counts as a full PASS in the headline
   12/12 while explicitly skipping a third of the ordered contract. The transcript is
   honest about it; the score is not.
3. **An error path with no coverage.** The probe stubs `/api/auth/session` with
   `services: ['gpxstudio']`, so it only ever exercises the authenticated branch. Both
   gate branches — precisely where the phase's regression lives — have zero automated
   coverage. The 12/12 green and gap 1 are not in conflict; the probe simply cannot see it.

### Gaps Summary

The phase goal — two surfaces on one shared dialog kit, hint bar instead of native
tooltips, click-opened dialog instead of a hover popover — is **structurally achieved and
verified live in production**. The kit is real (not a stub), all five consumers import
through the single barrel, the hover-open wiring and every row-level `title=` are provably
deleted, the layer lifecycle is byte-identically preserved, and every ship-gate claim in
the SUMMARY held up when re-queried independently (svelte-check re-run, `gh` re-queried,
prod chunks re-walked by curl).

Two things stop it closing clean:

**Gap 1 (BLOCKER, phase-introduced, live).** The My Maps rebuild moved the "Add run"
control out of the auth-gated body into an unconditional footer snippet. Pre-phase it was
inside the `{:else}` arm; now the sign-in and access-denied screens both show a filled
primary CTA that closes the dialog, opens nothing (QuickStartHub gates on the same two
conditions), takes the Sign In button off screen with it, and leaves `quickStartOpen`
latched. This is a regression in the very surface this phase rebuilt, and it is the first
thing an unauthenticated visitor meets.

**Gap 2 (BLOCKER-class defect, but NOT this phase's doing).** The shared, never-cleared
`fileVersions` buffer is byte-identical to its pre-phase form — this phase did not write
it. Recorded as a gap anyway because the phase moved its trigger from a click-only
dropdown to a bits-ui `Sub` whose trigger opens on pointer-enter, widening the window in
which a stale list can be rendered — and actioned, since the items call
`handleLoadVersion(file, ver.version)`. I disagree with classifying this as a Phase 70
implementation failure; I agree it is real and should be fixed alongside gap 1 while the
file is open.

One truth is **present but behaviorally unverified**: the master-checkbox
collapse/dim/cascade. That mechanism was rewritten in this phase, gpx-studio has no test
runner, and all 12 probe assertions are read-only — not one toggles a checkbox. Presence
and wiring are proven; the transition is not. It needs a human pass, not a code fix.

Five human-verification items are recorded, the most substantive being the signed-in
session needed to finish exercising the six-section order contract.

---

_Verified: 2026-07-30T14:04:05Z_
_Verifier: Claude (gsd-verifier)_
