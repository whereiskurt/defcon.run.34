# CTF Judge + Scoring + Covert Submission Channel — Design

**Date:** 2026-07-13
**Status:** Design (approved for spec; not yet planned/built)
**Author:** KPH + Claude
**Related:** `2026-07-11-qr-service-design.md`, `2026-07-12-qr-resolver-spec-corrections.md`, `2026-07-12-qr-admin-crud-design.md`

---

## 1. Context & Reframe

The premise "review the CTF checker at q.defcon.run" surfaced a key correction: **there is no checker at q.defcon.run — there is a *forwarder*.**

What is live today (see `project_qr_resolver_phase2_4`):

- The q.defcon.run resolver Lambda parses `/ctf/<challenge>/<value>` and returns a **302** to `https://run.defcon.run/use1/ctf/claim?c=<challenge>&v=<urlencoded value>`, `Cache-Control: no-store`. It **never reads the `Ctf` row, never validates, never scores.**
- Log hygiene is deliberate: `ctfHandoffLog` **structurally cannot carry the guess** (no `value` param), so answers never leak into CloudWatch and scan-counters never see them.
- `run.defcon.run/use1/ctf/claim` — the handoff target — **does not exist yet. It 404s.** This is the unbuilt "Phase-5 judge."
- Admin CRUD for defining challenges **is** built (`/admin/qr` CTF forms), writing `Ctf` rows that **nothing currently reads**. Existing `Ctf` fields: `challenge, answer, points, effect, maxAttempts, rateLimitWindow, enabled, createdAt, updatedAt`.
- **Absent entirely:** answer validation, points accrual, `Solve`/`FirstBlood`/`Leaderboard` tracking, any per-user CTF state.

**Therefore this design builds the greenfield judge**: answer validation, a composed scoring model, per-user solve tracking, an admin CTF leaderboard, and a *covert* in-page submission channel — while preserving the existing forwarder + log-hygiene guarantees.

### Goals

1. A single judge core `judgeSolve(user, challenge, guess)` that validates, scores, and records — called by **both** front doors.
2. Scoring that composes three forces without contradiction: **scheduled time tiers**, **per-solve decline curve**, and a **max-solves cap**, plus a **first-blood** bonus.
3. Per-user solve tracking attributed to the signed-in **RunUser**, idempotent and cap-safe under concurrency.
4. A **covert submission channel** that looks like a cache-busted `.css` request, always returns `200 text/css`, and hides the award ack inside the CSS body — triggering a DC33-style celebration via a computed-style read, with **auth state invisible in the network tab**.
5. An **admin CTF-only leaderboard** at `q.defcon.run/admin/leaderboard`.
6. A clean **integration boundary** with the separate DC33 total-score migration: we expose the CTF contribution; we do **not** own the global total.

### Non-Goals

- The **global/total-score leaderboard** — a separate worktree is porting the DC33 leaderboard and will map CTF into a total. We expose a consumable CTF signal only.
- Anonymous-only play. Attribution is to a **signed-in RunUser** (with a park-and-claim fallback for never-signed-in visitors).
- Changing the visible QR-scan resolver behavior (the 302 handoff stays as-is).

---

## 2. Player Identity & Attribution

**Player = signed-in run.human user** (`session.user.authUserId`). Points accrue to that `RunUser`; the leaderboard is by real runner identity. This is the strongest anti-cheat posture and reuses the existing session.

**The `.defcon.run` cookie insight (load-bearing):** session cookies (`sess_run`, `sess_auth`, `_session`, …) are scoped to the parent domain **`.defcon.run`**, not a single host — this is the OIDC-broker SSO design. Because `run.defcon.run`, `q.defcon.run`, and the `defcon.run` apex landing are **all the same registrable site**, `SameSite=Lax` does **not** block requests between them, and the cookie is sent on same-site subresource requests. Consequences:

- **Any page under `defcon.run`** (apex landing, run., q., a vanity host) firing a request to the covert endpoint **ships the `.defcon.run` session cookie**. `HttpOnly` is irrelevant (the *server* reads it), and it is already `Secure`.
- So the covert endpoint can determine sign-in state and credit immediately — **even from the static landing** — as long as the visitor has an active SSO cookie.
- **Only a truly never-signed-in visitor** (no `sess_*` cookie) hits the **park-and-claim** fallback.

**Park-and-claim fallback (unauth):** an unauth covert hit returns the plain decoy `200` (indistinguishable) and **parks the flag against an anonymous nonce** (cookie/localStorage on the client + a server-side pending record keyed by nonce). On the visitor's next signed-in visit to run.defcon.run, the parked nonce is claimed and credited, firing the (now delayed) celebration. This fallback is the universal safety net; the signed-in path is the fast path.

---

## 3. Data Model

All on the shared `run-human-electro` DynamoDB table (ElectroDB, `service:"run"`, `version:"1"`), following the existing `$run#...` key convention (see `entities/qr.ts`).

### 3.1 `Ctf` entity — extend

Add scoring-model fields to the existing `Ctf` entity (keep `pk=[challenge]`, `sk=[]`, lowercase-normalized challenge). The `answer` field changes from plaintext to a **hash**.

| Field | Type | Meaning |
|---|---|---|
| `challenge` | string (pk) | lowercase-normalized id |
| `answerHash` | string | salted hash of the canonical flag (replaces plaintext `answer`) |
| `pointMax` | number | ceiling for the solve curve (before time-tier scaling) |
| `pointFloor` | number | floor the solve curve decays toward |
| `maxSolves` | number (`N`) | cap: solvers `1..N` earn points; `N+1`+ record a solve, earn 0 |
| `firstBloodBonus` | number | flat bonus added to solver `n == 1` |
| `timeTiers` | list of `{from, to, ceiling}` | UTC-ISO windows; the active window's `ceiling` overrides `pointMax` at solve time |
| `maxAttempts` | number | per-user attempt cap before lockout (already present; now enforced) |
| `rateLimitWindow` | number (s) | per-user rate-limit window (already present; now enforced) |
| `effect` | any | celebration payload hint (confetti style / message), permissive |
| `enabled` | boolean | challenge live flag |
| `solveCount` | number | atomic ordinal allocator (see §4) — internal counter |
| `createdAt`/`updatedAt` | string | as today |

> **Migration note:** existing `Ctf` rows carry plaintext `answer`. The admin CTF form re-saves an `answerHash` (and stops persisting plaintext). A one-time script hashes any existing plaintext answers, or admins re-enter them. Plaintext `answer` is removed from the model once migrated.

### 3.2 `CtfSolve` entity — new

One row per `(user, challenge)`. This row **is** the "has this user solved it" record and the per-user idempotency key.

```
pk      = $run#challenge_<challenge>          // all solvers of a challenge share a partition
sk      = $ctfsolve_1#user_<authUserId>       // unique per user -> idempotency key
gsi1pk  = $run#user_<authUserId>              // "all my solves" -> per-user list + leaderboard drill-in
gsi1sk  = $ctfsolve_1#challenge_<challenge>
attributes:
  challenge     : string
  user          : string   (authUserId)
  ordinal       : number   (n — the Nth solver)
  points        : number   (awarded; 0 if beyond the cap)
  firstBlood    : boolean  (n == 1)
  tierCeiling   : number   (the time-tier ceiling in force at solve time — audit)
  channel       : string   ("qr" | "covert")   // which front door
  solvedAt      : string   (UTC-ISO)
  createdAt / updatedAt
```

### 3.3 `RunUser` — extend

- `ctfScore : number` — running total (atomic `ADD`), the fast leaderboard key.
- `ctfSolves : number` — count of solved challenges.

`ctfScore` is a **rollup** for cheap reads; the `CtfSolve` rows are the **auditable source of truth** (a rebuild job can recompute `ctfScore = sum(CtfSolve.points)` for a user).

### 3.4 `CtfPending` entity — new (park-and-claim)

For unauth covert hits. Short-TTL row keyed by nonce.

```
pk = $run#ctfpending_<nonce>
sk = $ctfpending_1
attributes: challenge, submittedFlagHash, createdAt, ttl (DynamoDB TTL, e.g. 30 days)
```

On the visitor's next signed-in run.defcon.run request, the client presents its parked nonce(s); the server validates the pending row still holds and runs `judgeSolve` for that user, then deletes the pending row. The parked record stores a **hash of the submitted flag**, never the raw guess in logs.

---

## 4. Judge Core

A single pure-ish function both front doors call:

```
judgeSolve({ user, challenge, guess, channel }) -> { solved, points, ordinal, firstBlood, capped }
```

**Flow (idempotent, cap-safe under concurrency):**

1. **Load challenge.** If `!enabled` → treat as non-solve (return decoy-equivalent).
2. **Attempt-cap / rate-limit.** Read/increment a short-TTL per-user attempts counter (keyed `$run#ctfattempt_<challenge>_<user>`, TTL = `rateLimitWindow`). Over `maxAttempts` within the window → reject as non-solve (no scoring, still return a plausible ack for the covert channel to keep auth/attempt state invisible).
3. **Validate.** `hash(guess) == Ctf.answerHash`? If not → non-solve. **The raw guess is never logged** (extends the resolver's `ctfHandoffLog` hygiene invariant to the judge).
4. **Claim the slot.** Conditional put of the `CtfSolve` row with `attribute_not_exists(sk)`. If it **fails** (user already solved) → **no-op scoring**, but still return `solved:true` with the *previously awarded* points (so a re-trigger still celebrates, never double-scores).
5. **Allocate ordinal.** Atomic `ADD Ctf.solveCount 1` → returns `n`. Because step 4 gated per-user, concurrent *different* users get distinct `n`; a single user double-submitting never reaches step 5 twice.
6. **Score.** `points = computePoints(n, Ctf)` (see §5). Patch the `CtfSolve` row with `ordinal=n`, `points`, `firstBlood=(n==1)`, `tierCeiling`, `channel`. Atomic `ADD RunUser.ctfScore points`, `ADD RunUser.ctfSolves 1`.
7. **Return** the result for the front door to render (visible page) or encode (covert CSS marker).

**Ordering rationale:** claim-then-allocate (4 before 5) guarantees the ordinal counter only advances for genuinely-new solvers, so `solveCount` stays an accurate, gap-free solver count even under concurrent submits and retries.

---

## 5. Scoring Model

Three forces composed into one number at submit time:

- **Max solves `N`** (`Ctf.maxSolves`) — the cap *and* the curve denominator. Solvers `1..N` earn; `N+1`+ earn 0 but still record a solve and still get the celebration ("you got it — already maxed").
- **Per-solve decline curve** — successive solvers are worth less, walking from a ceiling down to `pointFloor` across the `N` slots.
- **Scheduled time tiers** — the active `timeTiers` window's `ceiling` (else `pointMax`) sets the ceiling the curve decays *within*. *When* you solve sets the ceiling; *how early among the N* sets how close to it you land.
- **First blood** — flat `firstBloodBonus` added when `n == 1`.

```
computePoints(n, ctf):
  if n > ctf.maxSolves: return 0
  ceiling = activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax
  span    = ceiling - ctf.pointFloor
  # linear decline across the N slots; N==1 => full ceiling
  frac    = (ctf.maxSolves == 1) ? 1 : (1 - (n - 1) / (ctf.maxSolves - 1))
  base    = ctf.pointFloor + span * frac
  bonus   = (n == 1) ? ctf.firstBloodBonus : 0
  return round(base) + bonus
```

**Worked examples** (`pointMax=1000`, `pointFloor=100`, `N=100`, `firstBloodBonus=500`):

| Scenario | ceiling | n | points |
|---|---|---|---|
| Release window, first solver | 1000 | 1 | 1000 + 500 = **1500** |
| Release window, solver #50 | 1000 | 50 | ~**555** |
| Release window, solver #100 | 1000 | 100 | **100** |
| Aug 8 window (ceiling 250), first solver | 250 | 1 | 250 + 500 = **750** |
| Any time, solver #101 | — | 101 | **0** (celebration still fires) |

Curve is **linear** in v1 for predictability/admin-legibility. The shape is isolated in `computePoints`, so swapping to a curved decline later is a one-function change.

---

## 6. Two Front Doors

Both funnel into `judgeSolve`. They differ only in transport and rendering.

### 6.1 Visible claim page — physical QR scans (existing handoff)

- Unchanged resolver: `q.defcon.run/ctf/<challenge>/<value>` → 302 → `run.defcon.run/use1/ctf/claim?c=&v=`.
- **New:** build the `run.defcon.run/use1/ctf/claim` route (currently 404). It reads the session, calls `judgeSolve`, and renders a **visible** result page (solved/points/first-blood, or a graceful "not signed in — sign in to claim" that parks the flag). This is the overt, honest UX for someone who physically scanned a code.

### 6.2 Covert CSS asset — in-page eggs

- The egg (`!!!` triple-tap) injects a stylesheet request to a **no-cache, app-origin path on run.defcon.run** whose URL *reads like a cache-busted theme*, with the flag encoded as a build-date-looking `v` param — e.g. `…/theme.css?v=20260806` where `20260806` decodes to the flag (see §7).
- Response is **always `200 text/css`.** The award ack is hidden **inside the CSS body** (see §7). No JSON, no header tell, no status difference between signed-in-credited / signed-in-wrong / not-signed-in.
- The page reads the ack via `getComputedStyle` and fires the **DC33-style celebration** (confetti + effects) only on a win.

---

## 7. Covert Channel Details

### 7.1 Endpoint & disguise

- **Host:** run.defcon.run (it minted `sess_run`; verifying + crediting is trivial and the scoring data is local).
- **Path:** an app-origin route emitting `text/css`. The `.css` look is **cosmetic** (from `Content-Type` + path spelling), so we pick a path that CloudFront routes to the **app/ALB origin**, not an S3 static behavior (see §9). Example spelling: `run.defcon.run/use1/assets/theme.css?v=<encoded>`.
- **Flag encoding:** the `v` param looks like a build date / cache-buster (`v=20260806`, `v=1754467200`) but is a **simple number-encoded flag** — a reversible encoding (e.g. an integer transform / short numeric code the judge decodes to the challenge+flag). Keep it *plausible as a version stamp*; avoid obvious token shapes.

### 7.2 CSS-as-ack (the covert return channel)

- **No win / not signed in / wrong / capped-out-with-0:** the plain decoy stylesheet. A believable theme sheet, **byte-plausible** (same rough size/shape every time).
- **Win (signed-in + correct + credited):** the *same-looking* sheet with **one innocuous value different** — a CSS custom property that reads like a theme token, e.g. `:root{--accent-ramp: 734}` where `734` = points awarded (or a keyframe present only on a win).
- **Read-back:** the egg page's script does
  `getComputedStyle(document.documentElement).getPropertyValue('--accent-ramp')`
  after the sheet applies. Non-empty/non-zero → **rain + DC33 celebration** (and optional "you earned N points"). This is a **computed-style read, not a network event** — invisible to a network watcher; to a shoulder-surfer it's a stylesheet applying a theme.
- **Cross-origin note:** even when the egg lives on the apex landing, a cross-origin `<link>` still (a) ships the `.defcon.run` cookie (same-site) and (b) allows `getComputedStyle` on *elements* to read the applied custom property (CSSOM access to the sheet's rules is blocked cross-origin, but computed styles on elements are not). So the read-back works without CORS.

### 7.3 Invisibility invariants

- Identical HTTP status (`200`), `Content-Type` (`text/css`), and near-identical body size across all outcomes.
- **No differential logging** that could leak win/auth state or the flag; the judge never logs the raw guess.
- The only observable difference is a value buried in the CSS body, and even that reads as a theme token.

---

## 8. Admin

### 8.1 CTF CRUD — extend existing `/admin/qr` forms

Add the new `Ctf` fields to `CtfForm`: `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus`, `timeTiers[]` (reuse the **datetime-local + preset-chip picker** already built for QR rules), and answer entry that **hashes on save** (`answerHash`, plaintext never persisted). `maxAttempts` / `rateLimitWindow` stay.

### 8.2 CTF leaderboard — `q.defcon.run/admin/leaderboard`

- **CTF-only** board: rank users by `RunUser.ctfScore`; drill into a challenge to list `CtfSolve` rows (user, ordinal, points, first-blood, channel, time).
- **Hosting wrinkle:** q.defcon.run is a bare resolver Lambda with no HTML/admin surface. Rather than grow the resolver into an app server, add a **CloudFront behavior on the q distribution routing `/admin/*` → the run.human ALB origin** (forward cookie, no-cache). run.human renders the page under its existing `ADMIN_GROUPS` gate (`admin | runadmin`), session riding the `.defcon.run` cookie same-site. Net: the URL is `q.defcon.run/admin/leaderboard`; run.human does the work and the gate.
- Reads only; CSV export optional (reuse existing admin CSV helper with the OWASP formula-injection guard).

---

## 9. Infrastructure & CloudFront

Two must-resolve items (flagged, not hand-waved):

1. **Covert CSS path.** run.defcon.run is a mixed-origin distribution (S3 landing + S3 assets + CMS media + ALB app + per-region ordered behaviors). The covert path MUST:
   - resolve to the **ALB/app origin** (land on the `/use1/*` app behavior), *not* a `*.css`/static S3 behavior — verify no higher-precedence extension behavior intercepts it;
   - be **`CachingDisabled`** (or cache-keyed on the session cookie + `v` so it's effectively per-request) — otherwise one player's response is served to all;
   - **forward the session cookie** (the app behaviors already use `AllViewerExceptHostHeader`).
   Pick the exact path + a dedicated ordered behavior during planning; confirm with a live curl matrix (signed-in vs not, correct vs wrong).

2. **q `/admin/*` → run.human.** Add an ordered behavior on the q.defcon.run distribution routing `/admin/*` to the run.human ALB origin (cookie-forward, no-cache). Leaves the resolver behavior (default) untouched.

No new Lambda for the judge — it lives in run.human (Next.js route handlers), which already writes `run-human-electro` with the right creds. The resolver and rollup Lambdas are unchanged.

---

## 10. Anti-Cheat & Hygiene

- **Hashed answers** (`answerHash`, salted) — a table leak doesn't reveal flags.
- **Never log the raw guess** — judge + covert endpoint + park-and-claim all store/emit only hashes; extends the resolver's existing log-hygiene invariant.
- **Idempotent per-user solve** — `CtfSolve` conditional put; no double-scoring on re-trigger/replay.
- **Atomic cap & ordinal** — `ADD Ctf.solveCount` guarantees a gap-free solver count and a hard cap under concurrency.
- **Per-user attempt cap + rate-limit window** — enforced before validation using `maxAttempts` / `rateLimitWindow`.
- **Covert invisibility** — uniform `200`/content-type/size; no auth/win tell in status, headers, or logs.
- **Open-redirect / injection** — challenge ids stay lowercase-normalized; covert `v` decoding is total (never throws, unknown → decoy).

---

## 11. Integration Boundary (DC33 total-score migration)

- We **own** the CTF contribution and expose it as a stable signal: `RunUser.ctfScore` (rollup) + `CtfSolve` rows (source of truth, queryable by user via `gsi1`).
- We **do not** build or own the global/total leaderboard. The DC33-migration worktree's mapping process reads our signal and rolls CTF into the total.
- We **do not** assume their schema. If they need a specific shape, expose it via a thin read (e.g. a documented query or a small export), not by coupling our writes to their model.
- The q admin leaderboard is explicitly **CTF-only**; the global board is their surface.

---

## 12. Testing Approach

- **Scoring unit tests** — `computePoints` across tier boundaries, first-blood, cap edge (`n==N`, `n==N+1`, `N==1`), floor/ceiling.
- **Judge concurrency/idempotency** — simulate concurrent same-user (one solve) and concurrent distinct-users (distinct ordinals, no gaps); replay a solved user (no double-score, still celebrates).
- **Covert invisibility** — assert identical status/content-type and near-identical body size across signed-in-win / signed-in-wrong / unauth; assert the raw guess never appears in logs.
- **Park-and-claim** — unauth hit parks a nonce; later signed-in claim credits exactly once; expired nonce no-ops.
- **CloudFront live matrix** — curl the covert path signed-in vs not, correct vs wrong; confirm app-origin routing + no caching + cookie forwarding; confirm `q.defcon.run/admin/leaderboard` renders under the gate.
- **Admin** — CTF CRUD round-trips the new fields; answer hashes on save; leaderboard ranks by `ctfScore` and drills into `CtfSolve`.

---

## 13. Open Items / Defaults Locked

- **Time-tier = ceiling** the solve curve decays within (not independent multipliers). *Locked.*
- **Linear** solve-decline curve in v1 (isolated in `computePoints` for later swap). *Locked.*
- **First-blood bonus** = per-challenge admin field. *Locked.*
- **Covert host** = run.defcon.run (q keeps the visible QR handoff). *Locked.*
- **Flag encoding** exact numeric transform for `v` — pick during planning (reversible, version-stamp-plausible).
- **Covert path** exact spelling + CloudFront behavior — pick during planning, verify with live curl matrix.
- **DC33 celebration** exact effect set — port from DC33 during implementation; gate behind the computed-style read.
