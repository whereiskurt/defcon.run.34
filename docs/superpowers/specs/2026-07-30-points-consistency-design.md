# Points Consistency Design — one score, three streak tracks, derived scoring

**Date:** 2026-07-30
**Status:** Approved design, pre-implementation
**Scope:** apps/run.human (scoring core), apps/run.gpx (reconcile triggers), apps/run.mqtt/meshtk (bot-unlock admit), seed scripts

## Problem

Points are awarded today by three independent systems with inconsistent values and
ownership: activity (flat 1/run via `Accomplishment` rollup), CTF (per-flag curves via
`judgeSolve` accrual), and social (hardcoded +1/+1 to `ctfScore`/`socialScore`,
bypassing the judge). Awards are frozen at solve time, so config changes and deletions
don't re-value scores; social scans silently inflate the main leaderboard; the jack-egg
writes 25 CTF points the CTF tooling cannot see or unsolve; and point values live in
four different places (two constants files, per-row DDB config, hand-created put-items).

## Goals

1. **Reward consistency**: showing up all 4 con days is the dominant score driver, per
   track (runs, social, CTF).
2. **Reactive scores**: adding/removing runs, solves, or scans — or retuning a flag's
   value — changes affected users' scores on the next rescore. Nothing is frozen.
3. **One scoring engine**: all flag-like awards go through `judgeSolve`; one pure
   function values everything; one code path writes score fields.

## The point model

**Visible score** = `runStreak + socialStreak + ctfStreak + flagPoints`. The
`activityScore`/`ctfScore`/`socialScore` split disappears from scoring; UI chips may
still show the per-track breakdown.

### Streak tracks

Shared table `STREAK_POINTS = [0, 25, 50, 100, 500]`, indexed by the number of
**distinct con days active** on that track. Total-by-streak semantics: the track's
total IS the table value (4 active days = 500 for that track, not 675). Con days are a
4-date Pacific-timezone constant.

| Track | A day lights when… |
|---|---|
| Run | a con-day-tagged run (`gpx`/`strava` Accomplishment) exists for that day, **or** a check-in happened that day |
| Social | a `SocialPair` scan involving the user was admitted that day (either direction) |
| CTF | at least one admitted flag solve event exists for that day (an over-`globalMax` capped solve still lights the day) |

Per-scan, per-run, and per-check-in points are **zero**. Distance and elevation are
ignored (display-only, as today).

### Flag values

All values are per-flag `Ctf` rows, all defined in one DC34 seed script. No
hand-created put-items.

| Flag class | Value | Notes |
|---|---|---|
| Keystroke/UI eggs (`!!!` dc34-egg, rainbow, coffee, deuce, sao) | flat 5 each | rows move from manual put-items into the seed |
| Jack-egg (QR long-press/triple-tap) | flat 10 | becomes a real `Ctf` row claimed through `judgeSolve` (internal server-side answer) |
| Daily OTP chains | flat 25 per claim | `perPlayerIntervalHours: 24`; retuned down from 100 because the streak track now carries the consistency reward; chains remain the guaranteed way to light a CTF day |
| Payphones (`didhtp*`) | decay 200 → 100 | `pointMax: 200`, `pointFloor: 100`, linear by solve ordinal |
| Bot unlocks (goldstein and every other chat-unlockable ghost) | flat 250 | NEW award: the TOTP unlock itself admits a solve (see Mesh below) |
| Ricky's flag | flat 100 | his existing lyrics-line mechanic; ricky has no unlock |
| Exceptional-run admin bonus | flat 1000 | admin-awarded to a chosen user; hidden from the flag board |

First-blood bonuses and `timeTiers` are seeded to zero everywhere. The machinery stays
in `computePoints` but no DC34 flag uses it.

## Architecture: derived scoring (approach A)

Split "admitting an event" from "valuing the ledger".

### Event admission (unchanged responsibilities, no score writes)

- `judgeSolve` keeps every gate — unlock prerequisites, score windows, attempt caps,
  conditional-put dedup, ordinal allocation — and keeps writing `CtfSolve` /
  `CtfScoreEvent` ledger rows. It stops writing scores: `accrue`/`reaccrue` are
  deleted. A solve returns the admitted event; the calling route fires `rescoreUser`.
- The admin re-score override in `judgeSolve` is removed entirely (it existed to patch
  frozen awards; nothing is frozen anymore).
- Solve **ordinals stay frozen** (who solved 3rd is history); solve **values** are
  recomputed from the stored ordinal against current config at rescore time.

### Scoring engine (new)

- **`computeUserScore(events, config)`** — pure function. Input: the user's ledger rows
  (solve events with frozen ordinals, accomplishments, check-ins, scan-day events),
  current flag config, streak table, con-day dates. Output:
  `{score, breakdown, daysByTrack, latestActivityAt}`. `computePoints` (ordinal decay)
  moves here.
- **`rescoreUser(userId)`** — queries that user's events, runs the pure function,
  writes the result to `RunUser` in one update with a `rescoredAt` stamp. Idempotent.
  This is the **only** code path that writes score fields, enforced by an invariant
  test.

### Rescore triggers

Fires from: every event admit (solve, scan, accomplishment create/delete, check-in
create/delete), admin unsolve/award, the existing gpx reconcile and twice-daily Strava
sync self-heal, and a bulk `rescore-all` operator script for config changes and
backfill.

### Bugs deleted by construction

- `activityScore` read-modify-write race (no more incremental rollup).
- `latestActivityAt` regression on delete (now derived as max over events).
- `reaccrue` delta bookkeeping and the clamp-floor drift.
- Social/jack-egg points invisible to CTF unsolve tooling.

## Component changes

### Social path (`social-scan.ts`)

`judgeScan` keeps the pair-per-PT-day dedup and keeps writing per-user scan-day ledger
rows; the point constants and direct `ctfScore`/`socialScore` writes are deleted; it
fires `rescoreUser` for both parties. The 50/day cap remains as pure abuse throttling
(scans are worth 0 points). Attendance mode (qradmin cap-exempt bulk scanning) stays —
it is now just a fast way to light runners' social days. The jack-egg's hardcoded
+10/+25 goes away; it becomes a seeded `Ctf` row claimed through `judgeSolve`.

### Mesh / bots (meshtk + run.human internal API)

New secret-gated internal endpoint (same `x-internal-secret` pattern as
`/api/internal/ctf/mint`): when meshtk sees a radio pass a ghost's TOTP unlock, it
calls the endpoint; run.human maps radio → owner via the `MeshRadio` table and admits a
solve on that ghost's `unlock-<ghost>` flag (250) through `judgeSolve`. Ghost DM flag
reveals and magic-link claims keep working unchanged — they already route through the
judge.

### Admin

- New endpoint + console button: award `exceptional-run` (1000) to a chosen user,
  admitted through the judge's normal dedup so it is ledgered and unsolvable.
- Unsolve becomes uniform: delete event rows + rescore — now covers social-scan and
  jack-egg rows too.
- The "Recalculate score" button additionally triggers `rescoreUser`.

## Migration & rollout

1. **Seed script**: a DC34 seed replaces the DC33 starter — every flag row and value in
   code (eggs, jack-egg, chains, phones, bot unlocks, ricky, exceptional-run). A value
   change = edit seed → run seed → run `rescore-all`.
2. **Backfill**: existing ledgers (`CtfSolve`, `CtfScoreEvent`, `Accomplishment`,
   check-ins) already contain the needed history; one `rescore-all` pass converts every
   user. Old score fields stop being written; the board reads the new fields. The
   leaderboard is still admin-gated/hidden, so this lands without a flag day.
3. Per-user event queries: add GSIs where a per-user query path doesn't already exist
   (the leaderboard drill-down already reads per-user CTF ledger rows).

## Testing

- Table-driven unit tests on `computeUserScore`: streak table boundaries, ordinal
  decay, day-lighting edges around Pacific midnight, add/remove re-valuation.
- Invariant test: no module outside `rescoreUser` writes `RunUser` score fields
  (extends the existing covert-invariant test pattern).
- Integration round-trip: add run → rescore → delete run returns the user to the
  original score.

## Out of scope

- Un-hiding the leaderboard (separate decision).
- Region mirroring, MQTT changes beyond the unlock-admit call.
- Any change to money paths (bibs/donations remain point-free).
