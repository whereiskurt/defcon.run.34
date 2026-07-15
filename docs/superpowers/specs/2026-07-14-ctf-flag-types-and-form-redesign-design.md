# CTF Flag Types + Admin Form Redesign

**Date:** 2026-07-14
**Status:** Approved (design) — combined spec, code-verified 2026-07-14
**Supersedes:** `2026-07-14-ctf-admin-form-clarity-redesign.md` (the "A" clarity redesign is folded in as Slice 1's form work).
**Related:** `project_ctf_judge_v21` (v2.1 judge), `~/working/meshtk/pkg/otp/totp.go` (reusable TOTP — **upstream repo, not `apps/run.mqtt/meshtk`**), the `dc34-egg` seed.
**Mocks:** clarity form + flag-types proposal (see conversation artifacts).

> **Code-verification corrections (2026-07-14).** A read of the live code corrected three "reuse existing" assumptions this spec originally made. They are folded into the sections below; summarized here so nothing is lost:
> 1. **The `effect` reward channel is NOT wired today.** `Ctf.effect` is authored + stored but never read on the solve path: `judgeSolve` neither loads nor returns it (`JudgeResult` has no `effect` field), and the confetti component (`CtfCelebration.tsx`) is driven by a **boolean `active`**, not by `effect.kind`. The `otp-enroll` reward is therefore **net-new plumbing** end-to-end (judge loads+returns `effect` → non-covert solve API surfaces it → new client renderer) — and it must live **only on the non-covert solve response**, never the covert CSS path (see Reward reveal).
> 2. **TOTP source path was wrong.** The reusable Go is `~/working/meshtk/pkg/otp/totp.go` (upstream), not `apps/run.mqtt/meshtk/...` (which has no OTP code). It ports cleanly but has **no verify/skew** (only generation + adjacent periods) and its **default period is 120s, not 30** (see TOTP).
> 3. **QR needs no `eqr` reuse.** `qrcode@^1.5.4` is already a run.human dependency; render the `otpauth://` client-side with it (the `eqr` util isn't standalone anyway — it's inline in `run-user.ts`).

---

## Summary

Extend the CTF system from a single static-answer model into **multiple flag answer types**, **reward payloads**, **scoring windows**, **per-player/global limits**, and **flag chaining** — and, in the same pass, **redesign the admin form** for clarity (type presets + Advanced drawer + live preview + plain-language help + removed dead `Points` field).

The flagship user story is the **seed→OTP daily chain**:

> A **Static** flag `goldstein` — its reward on solve reveals an **OTP enrollment** (QR + rolling code). The runner adds it to their authenticator. A second **Rotating OTP** flag `goldstein-dawn`, **chained** behind `goldstein` and scoring only during **DEF CON run hours (Thu–Sun 6–8 AM PT)**, accepts that rolling code once per **24h** for points.

Everything rides existing machinery where possible: the reward reuses the `effect` payload channel; TOTP is ported from the real `meshtk` Go implementation; the leaderboard already reads the `RunUser.ctfScore` rollup unchanged.

---

## Build slices (ship order)

- **Slice 1 — seed→OTP core.** Split into two ship boundaries (distinct risk profiles):
  - **1a (backend).** Answer-type framework + Static + **Rotating OTP** (`ctf-otp.ts`) + judge gates (unlock + answer-type dispatch + cadence/caps) + the `CtfScoreEvent` ledger + **effect-return plumbing** (judge loads+returns `effect`; non-covert solve API surfaces it) + **per-24h + per-player-max + global-max** limits. Fully unit-testable, no UI blast radius.
  - **1b (frontend).** Form redesign (A) + the **`otp-enroll` reward renderer** (QR + rolling code reveal on the non-covert solve response).
  - Together they deliver the full daily-chain vision *except* time-of-day windows.
- **Slice 2 — scoring windows.** Day-of-week + time-of-day + timezone gating, with the "DEF CON run hours" quick set.
- **Slice 3 — wordlist one-time codes.** A pool of single-use codes, atomically consumed first-come.

Each slice (1a/1b included) is a shippable PR of run.human with its own tests. Planned/executed as GSD phases.

---

## Core concepts (two independent axes)

The mock's key lesson: **answer type** and **chaining** are different axes and must not be presented as peers.

- **Answer type** = *how* a flag is proven: `static` | `wordlist` | `otp`.
- **Reward** = *what the solver gets back*: points, and optionally an **OTP-enrollment payload** rendered on the solve response.
- **Scoring window & limits** = *when / how often* a correct solve scores.
- **Unlock (chaining)** = *when the flag appears* (hidden until a prerequisite flag is solved).

A single flag mixes these freely (e.g. `otp` answer + hidden-until-`goldstein` + Thu–Sun 6–8 window + once/24h).

---

## Data model (`Ctf` entity, `run-human-electro`)

Additive to the existing `Ctf` entity (`src/entities/qr.ts`). All new fields optional; **a row with no `answerType` is treated as `static`** so every shipped row keeps working.

| Field | Type | Slice | Meaning |
|---|---|---|---|
| `answerType` | `"static"\|"wordlist"\|"otp"` | 1a | default `static` |
| `answerHash` | string | (exists) | static answer (unchanged) |
| `otp` | map | 1a | `{ secret(base32), digits, period:120, algorithm:"SHA1", skew }` — the shared TOTP secret (must be stored to verify). **Note period default is 120s** (meshtk convention), not 30. |
| `effect` | any (exists) | 1a | stored today but **never read** — 1a adds the load+return path. New recognized `kind:"otp-enroll"` carries `{ otpauth, nextFlag? }` |
| `unlockAfter` | string | 1a | prerequisite challenge **name**; flag hidden + non-scoring until the player has scored it. ⚠️ name is mutable — renaming the prereq silently breaks the chain (acceptable at DC scale; flag it in admin copy) |
| `perPlayerIntervalHours` | number | 1a | min hours between a player's scoring solves (e.g. 24) |
| `perPlayerMax` | number | 1a | max scoring solves per player (repeatable flags) |
| `globalMax` | number | 1a | hard global scoring cutoff across all players (0/absent = unlimited). ⚠️ distinct from `maxSolves` (the scoring-curve denominator) — comment both loudly |
| `scoreWindow` | map | 2 | `{ days:[0-6], from:"HH:MM", to:"HH:MM", tz:IANA }` |
| `codePoolRef` | — | 3 | wordlist codes live in a companion entity (below) |

**Repeatable scoring — new `CtfScoreEvent` entity (Slice 1a).** Today `CtfSolve` enforces *one* award per `(challenge,user)` via a conditional put (`CtfSolve.create` → `attribute_not_exists` on the key, `ctf-judge.ts:289-309`). OTP daily flags are **repeatable**, so they need an append-only ledger — but **enforcement must stay atomic, not query-then-append** (a naïve "count then write" lets two concurrent submits of the same rolling code both pass the once/24h check → double award).

- `CtfScoreEvent`: `pk = challenge`, `sk = user#<bucket>`; GSI `byUser`. Attrs: `challenge`, `user`, `points`, `channel`, `scoredAt`, `tierCeiling`.
- **Once-per-window idempotency reuses the `CtfSolve` trick — put the time bucket in the sort key.** For a windowed flag `sk = user#<bucket>` where `bucket` = the floor of `scoredAt` to `perPlayerIntervalHours` (or the OTP period for tighter flags). Then the once-per-window guarantee is a **conditional put that collides atomically** (first writer in the window wins), exactly like `CtfSolve` — no read-then-write race.
- **`globalMax` uses an atomic counter, not a partition count.** Reuse the existing atomic `ADD Ctf.solveCount 1` pattern (`allocateOrdinal`, `ctf-judge.ts:311-316`): allocate the ordinal *first*, and if the returned `n > globalMax` treat it as a non-scoring solve (award 0 / no accrue). Do **not** enforce `globalMax` by querying the partition (racy). *(Drops the earlier "or partition count" hedge — atomic only.)*
- **`perPlayerMax`** (N-total, not windowed) is the one case that needs a real count/counter — a per-`(challenge,user)` atomic conditional-increment (`count < max`) or a query of `CtfScoreEvent.byUser`. Call it out separately from the windowed path above.
- Static one-award flags keep using `CtfSolve` (unchanged). A flag is "repeatable" when `answerType==="otp"` or `perPlayerMax>1` or `perPlayerIntervalHours` is set; repeatable flags write `CtfScoreEvent` instead of the one-shot `CtfSolve`. ⚠️ **Edit-semantics open item:** if an admin flips a flag static↔repeatable after solves exist, history splits across `CtfSolve` + `CtfScoreEvent`; leaderboard rollup still sums via `accrue`, but "have I solved this" reads must union both. Decide at planning (simplest: disallow answer-type change once solved).
- `RunUser.ctfScore`/`ctfSolves` accrue per scoring event exactly as today (`accrue` = `RunUser.patch().add({ctfScore, ctfSolves:1})`, `ctf-judge.ts:332-336`), so the leaderboard is unchanged.

**Wordlist — new `CtfCode` entity (Slice 3).** `pk = challenge`, `sk = codeHash`. Attrs: `codeHash` (salted, same scheme as answers), `claimedBy`, `claimedAt`. Claim = conditional update `attribute_not_exists(claimedBy)` → atomic single-use. Admin bulk-loads hashed codes; plaintext never stored.

---

## Judge design (`src/lib/ctf-judge.ts`)

`judgeSolve` gains ordered gates (all "fail = indistinguishable non-solve", preserving the covert-channel invariant):

1. **Load + enabled** (exists).
2. **Unlock gate** (Slice 1): if `unlockAfter` set and the player has no score for it → non-solve.
3. **Scoring window** (Slice 2): if `scoreWindow` set and `now` (evaluated in `scoreWindow.tz`) is outside the day/time window → non-solve.
4. **Rate-limit / anti-spam** (exists): wrong-guess throttle.
5. **Answer validation** by `answerType`:
   - `static`: `verifyAnswerHash` (exists).
   - `otp`: verify TOTP — accept if the guess equals the code for the current period or any within `±skew` (matches meshtk). See TOTP below.
   - `wordlist` (Slice 3): hash the guess; conditional-claim a matching unclaimed `CtfCode`.
6. **Idempotency / cadence (atomic — see ledger section):**
   - one-award flags: existing `CtfSolve` conditional put (`attribute_not_exists`).
   - repeatable flags: **conditional put on `CtfScoreEvent` keyed `user#<bucket>`** for the once-per-window guarantee (a collision = already-scored-this-window non-solve); `perPlayerMax` via a per-`(challenge,user)` count/counter; `globalMax` via the atomic ordinal (`n > globalMax` ⇒ award 0). No query-then-append.
7. **Score + accrue**: `computePoints` (exists) → `recordScore` + `accrue` (RunUser rollup). **Reward `effect` return is NEW (1a):** `judgeSolve` currently neither loads nor returns `effect` (`JudgeResult` has no field for it; `narrowCtf` doesn't carry it) — 1a adds `effect` to the loaded `Ctf`, to `JudgeResult`, and surfaces it on the **non-covert** solve response only. The covert CSS path (`covert-egg.ts`) stays byte-identical and carries no reward payload.

**Security notes:** OTP replay within a period is bounded by `perPlayerIntervalHours` (a runner can't re-submit the same 2-minute code for repeated points). Never log the guess or the OTP secret. TOTP secret at rest is inherent to verification (documented; not a regression — same trust level as `meshtk`).

---

## TOTP (new `src/lib/ctf-otp.ts`, Slice 1)

Port the ~120-line RFC 6238/4226 core from **`~/working/meshtk/pkg/otp/totp.go`** (upstream repo — the in-repo `apps/run.mqtt/meshtk` has **no** OTP code) to TypeScript using Node `crypto` (`createHmac("sha1")`), plus a base32 decoder (**Node has no built-in base32** — small decoder or dep; replicate the Go's uppercase-normalize + `=`-pad to 8). Exports:

- `parseOtpauth(url)` → `{ secret, digits, period, algorithm, label, issuer }` (Go `NewOTPHandler`; **defaults: digits 6, period 120, SHA1, issuer "Defcon.run"** — note period **120**, not 30).
- `totpAt(secret, unixSeconds, {digits,period})` → code string (Go `GenerateTOTP`).
- `adjacentCodes(secret, now, opts)` → `{ previous, current, next, remainingSeconds }` (Go `CalculateTOTPWithAdjacentPeriods`; for the reward reveal).
- `verifyTotp(secret, guess, now, {digits,period,skew})` → boolean (checks current ± skew periods; constant-time compare). ⚠️ **NEW logic — the Go has no verify/skew**, only generation; build it from `totpAt` over the ±skew window with `crypto.timingSafeEqual`.

Only SHA1 needed now (all DC33 seeds are SHA1); leave a switch for SHA256/512. Unit-tested against known RFC 6238 vectors (validate the HMAC/truncation core; note RFC vectors are 30s/8-digit — parameterize the test) and, optionally, against a code generated by a tiny meshtk Go harness at period 120.

---

## Reward reveal (client, Slice 1)

⚠️ **Correction:** there is **no effect-rendering handler today.** The confetti (`CtfCelebration.tsx`) is driven by a boolean `active` from `EggTrigger.tsx` — it does **not** dispatch on `effect.kind`, and `Ctf.effect` never reaches the client. So this is a **new** renderer wired to the **non-covert solve response** (which 1a extends to carry `effect`). Add an **`otp-enroll` renderer**: given `effect = { kind:"otp-enroll", otpauth, nextFlag? }`, show a card with

- a **real QR** of the `otpauth://` string using **`qrcode@^1.5.4` (already a run.human dependency)** rendered client-side — no new dep, no `eqr` extraction needed (the `eqr` util is inline in `run-user.ts`, not standalone),
- the **rolling code** (previous / current / next + countdown) via `adjacentCodes`,
- an **"Add to Authenticator"** action (the `otpauth://` deep link),
- a line naming the **next flag** the code unlocks (from `effect.nextFlag`, optional copy).

The `otpauth` handed out **is the downstream OTP flag's seed** — the admin sets the same seed on both the seed flag's reward and the chained OTP flag.

---

## Admin form redesign (folds in "A", Slice 1; extended in 2 & 3)

Single restructured `CtfForm.tsx`:

- **Name** · **Challenge type presets** (Flat points · First-blood race · Timed drop · Easter egg · Custom) that fill scoring — the approved "A" design.
- **Answer type** section (§1 of the mock): Static / Rotating OTP (+ Wordlist in Slice 3), with the per-type controls and, for Static, the **Reward on solve → OTP enrollment** option that configures the handed-out seed and shows the reveal preview.
- **Scoring window & limits** (§2): per-24h + **per-player max** + **global max** (both, per decision), and (Slice 2) the day/time/tz window with the **DEF CON run hours** chip (Thu–Sun 6–8 AM PT).
- **Unlock & chaining** (§3): hidden-until-[flag], with the seed→this visualization.
- **Advanced drawer**: raw curve/tier/anti-spam/effect knobs, always editable; presets pre-fill it.
- **Live scoring preview** mirroring `computePoints`. **Remove the dead `Points` field.** Answers/secrets masked / write-only.

Copy: plain-language help for **Ceiling** ("most a solve is worth while this window is active — replaces Point max"), **anti-spam** ("N wrong guesses per X seconds — not a solve limit"), and the always-visible **one-award / cadence** note.

---

## Timezone handling (decision)

`scoreWindow.tz` stores an **IANA zone** (`America/Los_Angeles` for the "PT" chip) and the judge evaluates `now` in that zone via `Intl.DateTimeFormat` — so DST is automatic and "6–8 AM PT" is correct in August (PDT) and off-season. The picker offers PT / ET / UTC; the value stored is the IANA id.

## Caps (decision: both)

Two independent caps, both surfaced and both enforced in the judge:
- **Per-player**: `perPlayerMax` (× per `perPlayerIntervalHours`) — a runner scores the daily flag at most N times.
- **Global**: `globalMax` — the flag stops scoring for everyone after N total scoring events (scarcity). Absent/0 = unlimited. (`maxSolves` remains the scoring-curve denominator; `globalMax` is the hard global cutoff.)

---

## Testing

- **TOTP** unit tests: RFC vectors + a code cross-checked against `meshtk`; `verifyTotp` skew boundaries; constant-time compare.
- **Judge** unit tests per gate: unlock (prereq unmet/met), window (inside/outside, DST boundary), per-player interval + max, global max, OTP accept/reject, wordlist single-use race (two claimers → one wins).
- **Repeatable ledger**: `CtfScoreEvent` accrual matches `RunUser.ctfScore`.
- **Form**: preset→Advanced mapping; preview vs `computePoints`; edit-mode type/answer-type inference; masked secrets never prefilled.
- **Reward**: `otp-enroll` effect renders QR + rolling code; static→enroll→chained-OTP loop e2e (manual/scripted).

## Rollout

Branch off `origin/main` (`gsd/ctf-admin-form-clarity` → renamed/tracked for the milestone, or a fresh `gsd/ctf-flag-types`). Ship each slice as its own run.human PR → review → release. No infra changes; no data migration (all fields additive; existing rows read as `static`). Answer/secret hashing uses the existing default salt (`CTF_ANSWER_SALT` unset in prod).

## Open items (non-blocking; resolve at phase planning)

- Whether to **unify** `CtfSolve` + `CtfScoreEvent` later (keep additive for now to protect shipped static behavior).
- **Edit-semantics of static↔repeatable** once solves exist (history splits across both entities). Simplest resolution: disallow answer-type change after first solve. Decide in 1a planning.
- Board **visibility** of chained flags (hidden vs shown-locked) — default: hidden until prerequisite scored.
- ✅ **RESOLVED — QR:** use `qrcode@^1.5.4` (already a dep), rendered client-side; no `eqr` reuse.
- ✅ **RESOLVED — effect schema:** `{ kind:"otp-enroll", otpauth, nextFlag? }`.
- ✅ **RESOLVED — TOTP source:** `~/working/meshtk/pkg/otp/totp.go` (upstream); verify/skew is new logic; period default 120.
