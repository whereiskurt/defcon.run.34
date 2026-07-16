# run.gpx — Runner-Centric File UX Redesign

**Date:** 2026-07-16
**Status:** Design — pending user review
**App:** `apps/run.gpx/` (Next.js webapp + vendored gpx.studio SvelteKit editor)

---

## 1. Problem

The current file experience fights itself with three competing concepts:

- **Local file** (native "Local Open" / "Export All")
- **Cloud save** (a "Save to Cloud" flow)
- **A mode-shifting dialog** (`CloudStorage.svelte`) that is Save, Open, *and* Browse at once, driven by a `CloudStorageMode` enum (`SAVE` / `OPEN` / `BROWSE`).

The result is a nine-item File menu (New, Local Open, Open Remote…, Save As…, Save All, Auto-Save, Close, Close All, Export All…) and a dialog whose meaning changes underneath the user. The machinery is all there and works — the *metaphor* is the mess.

**All functional pieces already exist.** This is a UX simplification, not a rebuild. No existing capability (public/private sharing, community publish, aggregate opt-in, folders, versions, auto-save, Strava import) is removed — several are relocated to clearer homes, and a small amount of net-new work is added (con-day tagging, per-user Strava button, per-con-day quota, bulk day-assignment).

## 2. The one idea

**There is one thing: your maps, which live in your DEF CON run folder.** Your computer and Strava are just *sources you add from*. The cloud is not a "save destination" the user thinks about — it is simply *where the maps are*, always, automatically (auto-save already does this).

```
  OLD (3 competing concepts)          NEW (1 concept)
  Local Open / Save As / Open         MY MAPS  (your folder = home)
  Remote / Cloud Storage / Export       ← you ADD to it from:
                                            • Strava   • a file   • drawing
                                          ← "save" disappears (auto-save)
                                          ← "export" = quiet way to get bytes back
```

## 3. Primary user & job

**Hero job:** *"Log today's run."* A runner finished a run, has it on a watch/phone (usually via Strava) or as a `.gpx` file, and wants it **on the map, saved to their DEF CON run folder, tagged to the con-day, and counting toward flags** — in as few taps as possible.

**Two doors** into that job:
1. **From Strava** — shown only when the runner has linked Strava. The more common path.
2. **Upload a file** — always available. The no-Strava path.

## 4. Con-day model (the one genuinely new data concept)

Flags key off *"I logged a run on con-day X."* (Decision: **day is the unit** — no official-run schedule/matching in this milestone.)

- New optional field `conDay` on `GpxFile` — an ISO date string (`YYYY-MM-DD`) constrained to the set of DEF CON run days.
- Con days are **config-driven** (a `CON_DAYS` constant): DEF CON 34 main days are **Thu Aug 6 – Sun Aug 9, 2026** (exact list, and any pre-con day, to be confirmed against the official schedule during planning).
- **Picker rules:** defaults to **today** (the con-day matching the current date, if within the con); **future con-days are disabled** (can't log a run that hasn't happened); past con-days selectable (log yesterday's run).
- **Auto-guess from the file:** on upload, parse the first trackpoint `<time>` in the GPX, take its calendar date, and match it to a con-day. Used as the default selection; always user-overridable. Files with no timestamp or a date outside the con are flagged and require a manual pick.
- **Flag/scoring seam:** `conDay` travels with the accomplishment payload already sent from the confirm route (`lib/gpx-accomplishment.ts` → run.human `/api/internal/accomplishment`). run.human owns flag accounting; run.gpx is the producer. (Exact payload field addition confirmed in planning.)

## 5. Hero flow — the "Log your run" card

A **fun, dismissible card that floats over the map** — not a menu item buried in a dropdown, and not a hard full-screen modal after first use.

```
  FIRST LOAD (or click launcher)          DISMISSED STATE
  ┌────────────────────────────────┐      ┌────────────────────────────┐
  │  ~map lit up behind, dimmed~   │      │  ~map, full & clear~       │
  │    ╭──────────────────────╮    │      │                            │
  │    │  👟 Log your run       │    │      │                    ╭─────╮ │
  │    │  Which day?           │    │      │                    │ 👟 + │ │ ← launcher
  │    │  [Thu][Fri][Sat•][Sun]│    │      │                    │ Add  │ │   (corner FAB)
  │    │  ⟳ From Strava        │    │      │                    ╰─────╯ │   click → card back
  │    │  ⬆ Upload a file      │    │      │                            │
  │    │  2 of 10 runs · Sat   │    │      │                            │
  │    │                  [×]  │    │      │                            │
  │    ╰──────────────────────╯    │      │                            │
  └────────────────────────────────┘      └────────────────────────────┘
```

- **First load:** card floats over a dimmed map. Invites the #1 action without blocking exploration (map is visible behind it).
- **Dismiss `[×]`:** card slides to a small **"👟 + Add"** launcher pinned in a corner; map fully clear.
- **Click launcher:** card returns. It is a summonable panel, not a takeover — it never fights the map (matters for "is my run actually on here?").
- **Smart first-load:** pop the card on load **only if there is an action to take** — i.e., the runner has con-day quota remaining today. If they're already at cap for today / already logged, stay collapsed as the launcher. The card earns its interruption.
- **Con-day picker sits at the top of the card**, answered once regardless of which door is used; defaults to today, so most people never touch it.

**Strava door** (linked only): pulls recent activities, shows those *not already in the folder* (dedupe by `stravaActivityId`), runner taps today's run → lands on map, saved to folder, tagged, scored.

**Upload door:** drag/drop or pick a `.gpx` → same landing.

## 6. Bulk upload — "Upload many" with per-file day assignment

For the day-4 "dump all my runs at once" case. Lives under **File ▸ Bulk ▸ Upload many…** (next to Export all).

```
  Upload many — one day per file
  ┌────────────────────────────────────────────────────────┐
  │  12 files                        Auto-guess from GPS ⚡ │
  │  ──────────────────────────────────────────────────────  │
  │   morning_thu.gpx     ⏱ Thu 06:12  →  [ Thu ▾ ]  ✓     │ ← guessed from <time>
  │   foam_run.gpx        ⏱ Fri 21:03  →  [ Fri ▾ ]  ✓     │
  │   track_003.gpx       ⏱ none       →  [ pick… ▾] ⚠     │ ← no DTS, must choose
  │   sat_long.gpx        ⏱ Sat 07:40  →  [ Sat ▾ ]  ✓     │
  │  ──────────────────────────────────────────────────────  │
  │  ⚠ 3 need a day  ·  9 auto-assigned                      │
  │  Thu:2  Fri:3  Sat:4  Sun:0    ← per-con-day tally vs cap │
  │                                       [ Import 12 ]      │
  └────────────────────────────────────────────────────────┘
```

- Each file's con-day is **auto-guessed** from its first trackpoint `<time>`; every guess is editable via a per-row dropdown.
- Files with **no timestamp** or a **date outside the con** are flagged `⚠` and **block import until assigned**.
- A running **per-con-day tally** shows how the batch lands against each day's cap before import.
- Each imported file consumes one unit against its con-day's cap (see §8).

## 7. My Maps — unified open/browse (replaces the mode-shifting dialog)

The `CloudStorage.svelte` dialog stops shape-shifting. It becomes one thing: **your stuff, grouped by con-day.**

```
  ┌──────────────────────────────────────────────┐
  │  My Maps                                [×]  │
  │  ────────────────────────────────────────    │
  │  📁 My runs                                  │
  │     ▸ Sat  · Morning 5K.gpx      🔗 ⋯        │  🔗 = share   ⋯ = rename/delete/versions
  │     ▸ Sat  · Night run.gpx          ⋯        │
  │     ▸ Fri  · Shakeout.gpx        🔗 ⋯        │
  │  📁 Rabbit Routes (shared)  🌐               │  existing GLOBAL folders, read-only
  │                                              │
  │  [ + Add run ]              [ Export ↓ ]     │
  └──────────────────────────────────────────────┘
```

- **No SAVE / OPEN / BROWSE modes.** Opening a map is just clicking it.
- **"Save As" is gone** — auto-save persists edits. **"Save All" is gone** for the same reason.
- Per-row **share (`🔗`)**, **rename / delete / version-history (`⋯`)** all survive from today's dialog.
- Grouped by con-day within "My runs" so the folder reads like a con timeline.
- GLOBAL / shared folders (e.g. "Rabbit Routes") still appear, read-only, with the globe marker.

## 8. Quotas — strong, and wired into the existing auth system

**Single source of truth = run.auth's `UserQuota` DynamoDB service.** run.gpx holds no quota state; `quota-client.ts` proxies to auth's atomic, race-safe, per-user counters. We wire into that — no parallel counter.

Three layers:

```
  ① Per con-day cap      10 runs max tagged to any one con-day   ← the "N of 10 · Sat" number
                         (count of the runner's files w/ conDay=X) ← catch-up-safe (per con-day,
                                                                      NOT per upload-day)
  ② Lifetime ceiling     gpx_upload = 100 / user (1000 admin)     ← already in auth; hard abuse wall
  ③ Strava burst guard   min interval between syncs + dedupe      ← no flood; each imported
                         + each imported activity consumes ①        activity counts against ①
```

- **Decision: 10 runs per runner per con-day.** Because the cap is keyed on `conDay` (not the real upload date), a runner on day 4 can bulk-upload all four days' runs at once — each con-day has its own budget of 10.
- **Both doors consume the same budget** — a Strava-synced activity and a manual upload both decrement the same con-day count, so switching doors can't bypass the cap.
- **Tiers** are `zero | upload | admin` (from `services[]` / `authProfile.quotaTier`) — *not* rabbit/og/wildhare (those are display identities, unrelated to quota). Admin effectively uncapped.
- **UX:** the cap is shown *before* the click (on the card and the Add button, e.g. "2 of 10 · Sat"). When a day is full, it's reframed as *done* ("✓ You've logged your runs for Sat — daily limit reached"), not an error popup.

**Implementation note (per-con-day cap).** The existing auth quotas are per-user countdowns with `none`/`event`/`daily` reset policies. A "10 per con-day" cap is naturally a **count of `GpxFile` rows where `conDay = X`** for the user (queryable via a `conDay` GSI or filter), checked at add time — *not* a calendar-daily-reset countdown. Auth's `daily`-reset machinery exists and is tested but keys on the real calendar day, which would break day-4 catch-up; hence the count-based per-con-day approach. The lifetime `gpx_upload` (100) auth quota remains the hard ceiling and is already consumed on upload. Exact enforcement seam (new count check in `api/gpx/files` + the Strava import path) finalized in planning.

## 9. Overlays — master collapse / off

The official DEF CON route overlays must be silenceable in one tap so the layer panel isn't a wall of routes.

```
   EXPANDED                          COLLAPSED (one tap)
   ┌────────────────────────┐        ┌────────────────────────┐
   │ DEF CON Routes   [◉ on]│        │ DEF CON Routes  [○ off]│ ← master kills + collapses all
   │  ☑ Thursday 5K         │        └────────────────────────┘
   │  ☑ Foam party route    │
   │  ☑ Night run           │          ↑ the whole route list
   │  ☑ ...12 more...       │            folds to one row
   │  ─────────────         │
   │  All Runners heatmap ☐ │
   └────────────────────────┘
```

- One **master toggle** both **hides the routes on the map** and **collapses the list** to a single row.
- Per-route toggles + the "All Runners" aggregate remain underneath when expanded.
- Builds on the existing `PublicOverlays.svelte` group-toggle; this adds the collapse-the-list behavior and makes "all off" a single obvious control.

## 10. Simplified File menu

```
   BEFORE (9 items)              AFTER (5 groups)
   New                          + New route         ⌘+
   Local Open                   ☁ My Maps…          ⌘O     ← open/browse your folder
   Open Remote…                 + Add run…                 ← the card (Strava / file)
   Save As…                     ───────
   Save All                     Bulk ▸  ⬆ Upload many…
   ✓ Auto-Save                          ⬇ Export all…
   Close                        ───────
   Close All                    ✓ Auto-Save
   Export All…                  Close · Close All
```

- **Removed:** Save As, Save All (auto-save covers both). Local Open / Open Remote collapse into **My Maps** + the **Add run** card.
- **Moved:** Export All → **Bulk** submenu, beside **Upload many**.
- **Kept:** New (draw a fresh route — a planning act, distinct from logging a recorded run), Auto-Save toggle, Close / Close All (these clear layers from the canvas; they do not delete from the folder).

## 11. Preserved machinery (relocated, not removed)

Everything below stays and keeps working; the redesign only changes where the controls surface:

- **Per-file share links** — public *and* private, with expiry & allowed-emails (`GpxShare`, `ShareDialog.svelte`). Now reached via the per-row `🔗` in My Maps and a standard share icon on an open map.
- **Community "make public"** → request-share → admin publish → copy into curated **GLOBAL** folders (`request-share`, `admin/share-requests`, `publish` routes). Unchanged backend; surfaced as a "Share to the community" action.
- **Strava-compliance gating** — `publicShareEligible`, `source`, `convert-public` route. Strava imports stay non-public unless converted. Unchanged.
- **"All Runners" aggregate opt-in** — `includeInAggregate`, `aggregate-optin` route, public heatmap. Unchanged; toggle stays in the overlays/settings area.
- **Folders, versions, auto-save** — all retained. Folders can still exist; the default view groups by con-day.

## 12. Sharing, submission & visibility model

"Share" is currently one blurry verb. Split it into **three distinct actions with different trust models**, and make the runner→event path a reviewed queue rather than a link an admin must open.

```
  ① Share with a friend   →  a link (public, or private/email-gated)
                             peer-to-peer. NEVER becomes an official overlay.
  ② Submit to DEF CON run →  flags the file into an ADMIN REVIEW QUEUE.
                             No URL is generated; nobody has to click anything.
  ③ Admin: turn on for all →  promotes a queued route to a GLOBAL overlay.
                             On = on for everybody (part of the official
                             DEF CON Routes set, master-collapsible per §9).
```

**A runner's map has one visibility ladder:**

- **Private** (default) — only me, in my folder.
- **Shared via link** (①) — a peer link I generate to show a friend; does not make it official.
- **Submitted to DEF CON** (②) — offered to the event; pending admin review; not visible to others yet.
- **Promoted to global overlay** (③) — an admin turned it on for everyone; now an official route.
- **Aggregate opt-in** — contributes anonymously to the "All Runners" heatmap (independent of the above).

### Security posture (audited 2026-07-16 — currently safe by construction; keep it that way)

The threat considered: an admin, logged in on the `.defcon.run` SSO cookie, opening a booby-trapped user GPX that exfiltrates the session. Audit findings and the rules that must hold:

- **Admin review is a server-side, ID-based, metadata-only queue.** `admin/share-requests` returns filenames/distances/counts only — never the GPX body, never a URL. Approve/publish are pure server-side S3 copies. **An admin's authenticated browser never fetches or renders an attacker-controlled GPX.** This property is load-bearing — the review UI must keep rendering from server-provided metadata (and, if a route preview is ever shown, from server-sanitized geometry + CMS text only), never by opening a user share link.
- **Submission is data, not a link.** "Submit to DEF CON run" only sets `shareRequested` on the runner's own file. No admin-clickable URL is minted.
- **User GPX contributes geometry only; all displayed text is escaped.** Every GPX text field (`<name>`, `<desc>`, `<cmt>`, `<type>`, `<sym>`, waypoint names, `<extensions>`) is escaped (`escapeHtml`) or `sanitize-html`'d before touching the DOM, on every surface (editable popups, public overlays, ghost/rabbit/check-in layers, share-accept). No new sink may bypass this. Confirmed: no unescaped user-GPX → DOM sink exists today.
- **Official-overlay labels come from CMS, not from GPX.** When a route is promoted (③), its title/description/attribution are **CMS-authored, server-sanitized** content (same enrichment path as today's GLOBAL overlays via `/api/gpx/public/maps`). This is both the attribution mechanism and a security guarantee: an official route's visible text can never be attacker-controlled GPX text.
- **Session cookies are HttpOnly** (`sess_gpx` + auth cookies); JS cannot read the session. Residual note: the `.defcon.run` **wildcard cookie scope** means an XSS on any subdomain could make same-origin authed calls — reinforcing why the escape/geometry-only rules above are non-negotiable.

### Attribution

Resolved via the CMS-metadata path: at promote time (③) the admin authors the route's CMS entry, and **attribution is a CMS field** — credit the runner (e.g. rabbit/display name), keep it anonymous, or set a custom credit — decided per route. No separate visibility toggle is needed; the deeper metadata (title, description, credit) is fetched from CMS exactly like existing official overlays.

### Hardening follow-ups (low severity, fold into implementation)

- Verify the `/api/gpx/public/maps` manifest **server-side sanitizes** CMS rich-text (`descriptionHtml` is injected raw via `{@html}` — safe only if the manifest sanitizes).
- Add `rel="noopener noreferrer"` to sanitized `<a target>` links in waypoint popups (reverse-tabnabbing).
- Reconsider allowing `<img src>` in waypoint descriptions (silent tracking-pixel / IP-beacon vector).

## 13. Strava "Sync my Strava" button — feasibility

The full Strava→GPX pipeline already runs in production as a **batch, secret-guarded, all-users** job (`lib/strava-sync.ts`, `api/gpx/internal/strava-sync`): list activities → download streams → build GPX → S3 → `GpxFile` with dedupe. Token retrieval + OAuth refresh live in run.auth (`api/internal/strava-tokens`, `lib/strava-tokens.ts`). run.gpx already knows if the runner linked Strava via `session.user.linkedProviders`.

**Net-new work for the user-facing button is a thin refactor, not a new integration:**
1. Extract a **single-user** sync path from the batch orchestrator (fetch one runner's token; or add `?userId=` to the tokens API).
2. Add a **session-authenticated** user route in run.gpx (today's route is secret-only / all-users / env-date-banded).
3. Add a `hasStrava` convenience boolean (trivial; array already present).
4. Consume the per-con-day quota per imported activity + enforce the burst guard.

## 14. Scope / non-goals

- **In scope:** the one-concept mental model; the on-map dismissible Log-your-run card (Strava + upload doors); con-day tagging with GPX-timestamp auto-guess; bulk upload with per-file day assignment; unified My Maps; simplified File menu; overlays master collapse; per-con-day quota (10) wired into auth; the per-user Strava sync button; the three-verb sharing model (friend link / submit-to-DEF-CON queue / admin turn-on-for-all) with a first-class admin review queue and CMS-authored attribution.
- **Out of scope (this milestone):** an official-run schedule / matching a GPX to a specific scheduled run (day is the unit); any change to how run.human accounts flags beyond receiving `conDay`; redesign of the drawing/editing tools; changes to the public overlay data pipeline; a rebuild of the share/publish backend (reused as-is, only re-surfaced).

## 15. Open items to confirm during planning

- Exact `CON_DAYS` list & dates (incl. any pre-con day) vs the official DEF CON 34 schedule.
- The `conDay` field's place in the accomplishment payload and how run.human consumes it for flags.
- Whether the per-con-day count uses a new GSI on `GpxFile` or a filtered query.
- Final placement of Auto-Save and the aggregate opt-in (File menu vs Settings).
- Confirm `/api/gpx/public/maps` server-side sanitizes CMS rich-text (`descriptionHtml`); apply the `rel=noopener` and `<img>` waypoint-description hardening.
- The admin promote/turn-on-for-all dialog: CMS entry authoring (title/description/attribution) and the "on for everybody" toggle surface.
