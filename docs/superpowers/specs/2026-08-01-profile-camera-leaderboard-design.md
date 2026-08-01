# Profile: Camera, Palette Calm-Down, and "Your Standing"

**Date:** 2026-08-01
**App:** `run.human` (`apps/run.human/webapp`)
**Surface:** `/whoami` profile page + header user menu

## Problem

Three complaints, one screen:

1. **The camera is buried.** "Scan a runner" — the single most important social
   action at the event — lives *inside* the collapsed "Your Social QR" panel. A
   runner who wants to scan someone has to expand a panel first.
2. **The action bar is a rainbow.** `Add Run` green, `Link` orange, `Strava`
   orange, `Signal` blue — four saturated hues, none of them the brand's. The
   product's palette is teal `#00d4aa` on near-black with an amber accent
   (`tailwind.config.js`); the bar reads as four unrelated vendors shouting.
3. **The menu QR is the plain one.** The header dropdown's QR modal renders a
   bare `StyledRunnerQr` while the profile panel renders the `SocialQrFlair`
   version with rank frame, crown badge, and glow. Same identity, two grades of
   polish.

Plus one new want: a **"show me on the leaderboard"** entry point. The full
board (Phase 52) is built but deliberately hidden and admin-only. Kurt wants a
self-scoped view now — admins only until launch, everyone in a day or two.

## Design

### 1. Action bar → two tiers, one accent family

`src/app/(protected)/whoami/page.tsx`.

The joined `.cta-bar` segmented pill is replaced by:

**Row 1 — three buttons.**

| Button | Treatment | Action |
|---|---|---|
| `Add Run` | solid green `#22c55e` (`.seg-addrun`) — the single loud primary | deep-links gpx QuickStart (`?addrun`), unchanged |
| `Scan` | teal outline, brand `primary` | opens `QrScannerModal` directly |
| `Leaderboard` | teal outline, brand `primary` | opens `YourStandingModal` — **gated**, see §3 |

**Row 2 — Strava as a text link.** `⚡ Link your Strava account →` in
`secondary` amber, rendered only when `!user.hasStrava`, disappearing once
linked. No fill, no border — it is a link, not a call to action.

**Removed from the profile entirely:** the Strava-group popout and the Signal
button. Both already exist as tiles on the landing page
(`src/app/(public)/page.tsx` — verified), which is where group-joining belongs.
Their CSS (`.seg-strava`, `.seg-signal`) is deleted from
`src/styles/globals.css`. `.seg-addrun` and the `.cta-bar` pulse survive,
retargeted to the green button alone.

**The duplicate scan button inside the Social QR panel is deleted**, not
duplicated — the whole point is that the camera moved up.

### 2. Menu QR → the same flair component

`src/components/header/dropdown-user.tsx`.

`SocialQrFlair` already takes `hash` / `eqrFallback` / `social` / `alt` as
props, and `dropdown-user.tsx`'s existing `/api/user` fetch already returns
`social` — so the flair QR drops into `QRModal` in place of the bare
`StyledRunnerQr` with no new data plumbing. The modal keeps its own chrome
("Your Social QR" / "Share to connect with other rabbits!") and gains `Scan`
and `Save card` buttons so it is a full peer of the profile panel.

`QRModal` is currently a bare function taking positional arguments
(`isOpen, onClose, userDetail`) called as `{QRModal(...)}`. It grows two
buttons and needs modal state of its own, so it becomes a normal props
component rendered as `<QRModal … />`.

The `?open=qr` cross-app deep link (used by flash.defcon.run) keeps working
unchanged — it opens the same, now-upgraded, modal.

### 3. "Your standing" — self-scoped board view

**Launch switch.** New `src/lib/leaderboard-launch.ts`:

```ts
export const LEADERBOARD_SELF_ENABLED = false;
```

One constant, checked in exactly two places: button visibility and the API
handler. The effective gate is `LEADERBOARD_SELF_ENABLED || isAdmin(session)`.
Flipping it to `true` and releasing opens "Your standing" to every signed-in
runner. There is no second, divergent source of truth.

**New endpoint `GET /api/leaderboard/me`.** A thin shell over already-shipped
pure code, mirroring the existing `/api/leaderboard` handler:

- Gate: `requireAdmin` OR the launch flag. Every denial is a **bare 404** — no
  403, no body — matching the non-disclosure posture of the rest of the
  feature. When the flag is false and the caller is a non-admin, the route is
  indistinguishable from nonexistent.
- Admin path additionally revalidates live claims via
  `revalidateAdmin(session.user.authUserId)` — the **OIDC sub**, not
  `session.user.id` (the Phase-43 identity landmine).
- Data: `getCachedScan(scanAllRunUsers)` → `buildLeaderboard(...)` over the
  full set (so the rank is a true global rank) → locate the caller's row by
  `session.user.id` → return **that row only**, plus their accomplishments.
- **Self-scoped by construction:** the handler accepts no `userId` parameter
  and reads the identity solely from the session, so it cannot be aimed at
  another runner. No admin-gate surgery on the existing `/api/leaderboard` or
  `/[userId]/accomplishments` handlers — they are untouched.
- Runtime `nodejs`, `force-dynamic`, `Cache-Control: private, max-age=30` —
  same posture as the admin board handler.

**New `YourStandingModal`** (`src/components/leaderboard/`). Renders the single
row — global rank, `globalScore` 🥕, class emoji, count chips — expandable to
the runner's own accomplishments with `PolylineRenderer` thumbnails. Reuses
`deriveCountChips` and `runnerClassEmoji` from `@/lib/leaderboard-ui` so the
row reads identically to the full board.

**The full board stays hidden.** `/leaderboard` remains admin-only and linked
from nowhere. Because the profile opens a *modal* rather than linking the
route, `leaderboard-hidden.test.ts` passes unchanged — its `ROUTE_PATTERN`
already excludes API paths (`/api/leaderboard/me` — the `/leaderboard` there is
preceded by a word char and followed by `/`).

## Data flow

```
/whoami  ──[Scan]──────▶  QrScannerModal            (existing, moved up)
         ──[Leaderboard]▶  YourStandingModal
                              │
                              ▼
                    GET /api/leaderboard/me
                              │  gate: flag || admin  → else bare 404
                              ▼
                    getCachedScan(scanAllRunUsers)     (60s SWR, existing)
                              ▼
                    buildLeaderboard(...)              (pure, existing)
                              ▼
                    row where userId === session.user.id
                    + that runner's accomplishments
                              ▼
                    { row, accomplishments }

header ▾ ──[Show QR]──▶  QRModal → SocialQrFlair      (same component as /whoami)
```

## Error handling

- **API denial** → bare 404, no body. The client renders "Not available yet"
  rather than surfacing a status.
- **Runner absent from the board** (no scored activity yet) → 200 with
  `row: null`; the modal shows an encouraging empty state ("No standing yet —
  add a run or scan a runner") instead of an error.
- **Fetch failure** → inline retry inside the modal; the profile page is never
  blocked.
- **CMS copy absent** → every new string goes through the existing `copyOr`
  fallback idiom, so unset keys render the English default rather than a raw
  key.

## Testing

| Test | Asserts |
|---|---|
| `leaderboard-hidden.test.ts` (existing, **untouched**) | the board stayed hidden — no nav surface links `/leaderboard` |
| `api/leaderboard/me` — admin, flag false | 200 with the caller's row |
| `api/leaderboard/me` — non-admin, flag false | bare 404, empty body |
| `api/leaderboard/me` — non-admin, flag true | 200 with the caller's row |
| `api/leaderboard/me` — no session | bare 404 |
| `api/leaderboard/me` — payload scope | response contains exactly one row, and its `userId` is the session's |
| existing suites | `SocialQRRow.test.ts` + copy-catalog stay green |

## Non-goals

- Opening the full multi-runner board to non-admins. That is the later switch
  flip, and even then this design only exposes the caller's own row.
- Changing scoring, ranking, or the leaderboard data model.
- Touching the landing page's Strava/Signal tiles.
- cac1 — use1 is the only region carrying live service.
