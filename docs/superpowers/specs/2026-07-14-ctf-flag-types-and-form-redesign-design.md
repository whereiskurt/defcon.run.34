# CTF Flag Types + Admin Form Redesign

**Date:** 2026-07-14
**Status:** Approved (design) — combined spec
**Supersedes:** `2026-07-14-ctf-admin-form-clarity-redesign.md` (the "A" clarity redesign is folded in as Slice 1's form work).
**Related:** `project_ctf_judge_v21` (v2.1 judge), `meshtk/pkg/otp` (reusable TOTP), the `dc34-egg` seed.
**Mocks:** clarity form + flag-types proposal (see conversation artifacts).

---

## Summary

Extend the CTF system from a single static-answer model into **multiple flag answer types**, **reward payloads**, **scoring windows**, **per-player/global limits**, and **flag chaining** — and, in the same pass, **redesign the admin form** for clarity (type presets + Advanced drawer + live preview + plain-language help + removed dead `Points` field).

The flagship user story is the **seed→OTP daily chain**:

> A **Static** flag `goldstein` — its reward on solve reveals an **OTP enrollment** (QR + rolling code). The runner adds it to their authenticator. A second **Rotating OTP** flag `goldstein-dawn`, **chained** behind `goldstein` and scoring only during **DEF CON run hours (Thu–Sun 6–8 AM PT)**, accepts that rolling code once per **24h** for points.

Everything rides existing machinery where possible: the reward reuses the `effect` payload channel; TOTP is ported from the real `meshtk` Go implementation; the leaderboard already reads the `RunUser.ctfScore` rollup unchanged.

---

## Build slices (ship order)

- **Slice 1 — seed→OTP core.** Form redesign (A) + answer-type framework + Static + **Rotating OTP** + **OTP-enrollment reward** + **chaining/unlock** + **per-24h + per-player-max + global-max** limits. Delivers the full daily-chain vision *except* time-of-day windows.
- **Slice 2 — scoring windows.** Day-of-week + time-of-day + timezone gating, with the "DEF CON run hours" quick set.
- **Slice 3 — wordlist one-time codes.** A pool of single-use codes, atomically consumed first-come.

Each slice is a shippable PR of run.human with its own tests. Planned/executed as GSD phases.

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
| `answerType` | `"static"\|"wordlist"\|"otp"` | 1 | default `static` |
| `answerHash` | string | (exists) | static answer (unchanged) |
| `otp` | map | 1 | `{ secret(base32), digits, period, algorithm:"SHA1", skew }` — the shared TOTP secret (must be stored to verify) |
| `effect` | any (exists) | 1 | reward payload; new recognized `kind:"otp-enroll"` carries `{ otpauth }` |
| `unlockAfter` | string | 1 | prerequisite challenge name; flag hidden + non-scoring until the player has scored it |
| `perPlayerIntervalHours` | number | 1 | min hours between a player's scoring solves (e.g. 24) |
| `perPlayerMax` | number | 1 | max scoring solves per player (repeatable flags) |
| `globalMax` | number | 1 | max scoring solves across all players (0/absent = unlimited) |
| `scoreWindow` | map | 2 | `{ days:[0-6], from:"HH:MM", to:"HH:MM", tz:IANA }` |
| `codePoolRef` | — | 3 | wordlist codes live in a companion entity (below) |

**Repeatable scoring — new `CtfScoreEvent` entity (Slice 1).** Today `CtfSolve` enforces *one* award per `(challenge,user)` via a conditional put. OTP daily flags are **repeatable**, so they need an append-only ledger:

- `CtfScoreEvent`: `pk = challenge`, `sk = user#<ulid/ts>`; GSI `byUser`. Attrs: `challenge`, `user`, `points`, `channel`, `scoredAt`, `tierCeiling`.
- Static one-award flags keep using `CtfSolve` (unchanged). A flag is "repeatable" when `answerType==="otp"` or `perPlayerMax>1` or `perPlayerIntervalHours` is set; repeatable flags write `CtfScoreEvent` instead of the one-shot `CtfSolve`.
- `RunUser.ctfScore`/`ctfSolves` accrue per scoring event exactly as today (`accrue`), so the leaderboard is unchanged.
- Per-player cadence/max is enforced by querying `CtfScoreEvent.byUser` for this challenge (count + latest `scoredAt`). `globalMax` by the challenge partition count (or an atomic counter like the existing `solveCount`).

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
6. **Idempotency / cadence:**
   - one-award flags: existing `CtfSolve` conditional put.
   - repeatable flags: enforce `perPlayerIntervalHours` (now − latest event ≥ interval) and `perPlayerMax`; enforce `globalMax`; then append `CtfScoreEvent`.
7. **Score + accrue**: `computePoints` (exists) → `recordScore` + `accrue` (RunUser rollup). Reward `effect` returned in the result (exists).

**Security notes:** OTP replay within a period is bounded by `perPlayerIntervalHours` (a runner can't re-submit the same 2-minute code for repeated points). Never log the guess or the OTP secret. TOTP secret at rest is inherent to verification (documented; not a regression — same trust level as `meshtk`).

---

## TOTP (new `src/lib/ctf-otp.ts`, Slice 1)

Port the ~40-line RFC 6238/4226 core from `apps/run.mqtt/meshtk/pkg/otp/totp.go` to TypeScript using Node `crypto` (`createHmac("sha1")`), plus a base32 decoder. Exports:

- `parseOtpauth(url)` → `{ secret, digits, period, algorithm, label, issuer }`.
- `totpAt(secret, unixSeconds, {digits,period})` → code string.
- `verifyTotp(secret, guess, now, {digits,period,skew})` → boolean (checks current ± skew periods; constant-time compare).
- `adjacentCodes(secret, now, opts)` → `{ previous, current, next, remainingSeconds }` (for the reward reveal).

Only SHA1 needed now (all DC33 seeds are SHA1); leave a switch for SHA256/512. Unit-tested against known RFC vectors and against a meshtk-generated code.

---

## Reward reveal (client, Slice 1)

The solve-response handler already renders `effect` (confetti today). Add an **`otp-enroll` renderer**: given `effect = { kind:"otp-enroll", otpauth }`, show a card with

- a **real QR** of the `otpauth://` string (reuse the existing run.human QR generator used by the runner `eqr` card — no new dep if reusable; otherwise add `qrcode`),
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
- **QR generator reuse** vs adding `qrcode` (confirm the `eqr` util is importable server/client-side).
- Board **visibility** of chained flags (hidden vs shown-locked) — default: hidden until prerequisite scored.
- Exact **effect schema** for `otp-enroll` (`{ kind, otpauth, nextFlag? }`).
