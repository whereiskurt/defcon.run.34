# Phase 53: CTF Flag Types — Slice 1a Backend - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** Design Spec (approved, code-verified) — `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md`

<domain>
## Phase Boundary

**Slice 1a is the BACKEND ONLY** for the CTF flag-types framework. It extends the shipped v2.1
CTF judge (`judgeSolve`, `Ctf`/`CtfSolve` entities, `computePoints`, `allocateOrdinal`, `accrue`,
`narrowCtf` — all present in this worktree) from a single static-answer model into multiple
answer types, repeatable scoring, chaining, and reward-effect return.

**IN SCOPE (Slice 1a):**
- Additive `Ctf` entity fields (all optional; a row with no `answerType` reads as `static`).
- `src/lib/ctf-otp.ts` — TOTP core ported from `~/working/meshtk/pkg/otp/totp.go` (upstream repo).
- `CtfScoreEvent` append-only ledger entity for repeatable flags (atomic once-per-window).
- Judge gates: unlock/chaining, answer-type dispatch (static/otp), cadence + per-player-max + global-max.
- `effect`-return plumbing (judge loads + returns `effect`; non-covert solve response surfaces it).

**OUT OF SCOPE (later slices — do NOT build here):**
- Slice 1b: the admin **form redesign** (`CtfForm.tsx`) and the **`otp-enroll` reward renderer**
  (QR + rolling-code reveal). NO UI in 1a — "no UI blast radius" is a hard boundary.
- Slice 2: `scoreWindow` (day-of-week + time-of-day + IANA timezone gating). The `scoreWindow`
  field and its judge gate are Slice 2 — do not add them.
- Slice 3: `CtfCode` wordlist one-time codes and the `wordlist` answer type. Slice 1a answer types
  are `static` | `otp` ONLY (leave `wordlist` for Slice 3).

**Invariants that MUST hold:**
- **Covert-channel invariant preserved.** The covert CSS path (`covert-egg.ts`) stays byte-identical:
  every judge-gate failure is an indistinguishable non-solve, and the covert path carries NO reward payload.
- **Backward compatibility.** Every shipped `Ctf` row keeps working unchanged (no `answerType` ⇒ static;
  static one-award flags keep using `CtfSolve`).
- **Leaderboard unchanged.** `RunUser.ctfScore`/`ctfSolves` accrue via the existing `accrue` exactly as today.
</domain>

<decisions>
## Implementation Decisions

- **D-01 — Answer-type framework (CTFT-01)**
- Add optional `Ctf.answerType: "static" | "otp"`. **Absent ⇒ `static`** (backward compat).
- `wordlist` is Slice 3 — do NOT include it in the union yet (or include as an unused literal only if
  it costs nothing; the planner decides, but no `wordlist` judge path in 1a).

- **D-02 — New optional `Ctf` fields (CTFT-01), all additive**
- `otp`: map `{ secret (base32), digits, period: 120, algorithm: "SHA1", skew }` — the shared TOTP
  secret (stored so the judge can verify). **Period default is 120s** (meshtk convention), NOT 30.
- `unlockAfter`: string — prerequisite challenge **name** (mutable — renaming the prereq silently breaks
  the chain; acceptable at DC scale; call it out in a code comment).
- `perPlayerIntervalHours`: number — min hours between a player's scoring solves (e.g. 24).
- `perPlayerMax`: number — max scoring solves per player (repeatable flags).
- `globalMax`: number — hard global scoring cutoff across all players (0/absent = unlimited).
  ⚠️ **Distinct from `maxSolves`** (the scoring-curve denominator) — comment BOTH loudly.
- `effect`: already exists on the entity (`type: "any"`) but is **never read today** — 1a adds the read path.

- **D-03 — TOTP core `src/lib/ctf-otp.ts` (CTFT-02)**
- Port the ~120-line RFC 6238/4226 core from **`~/working/meshtk/pkg/otp/totp.go`** (upstream repo;
  the in-repo `apps/run.mqtt/meshtk` has NO OTP code). Use Node `crypto` (`createHmac("sha1")`).
- **Node has no built-in base32** — write a small decoder (uppercase-normalize + `=`-pad to 8, matching the Go).
- Exports: `parseOtpauth(url)` → `{secret,digits,period,algorithm,label,issuer}` (defaults: digits 6,
  period **120**, SHA1, issuer "Defcon.run"); `totpAt(secret, unixSeconds, {digits,period})` → code;
  `adjacentCodes(secret, now, opts)` → `{previous,current,next,remainingSeconds}` (for the 1b reward reveal — export now, used later);
  `verifyTotp(secret, guess, now, {digits,period,skew})` → boolean.
- ⚠️ **`verifyTotp` is NEW logic — the Go has no verify/skew**, only generation. Build it from `totpAt`
  over the ±skew window with `crypto.timingSafeEqual` (constant-time compare).
- SHA1 only now; leave a switch for SHA256/512.
- Test against RFC 6238 vectors (**parameterized** — RFC vectors are 30s/8-digit); optionally cross-check
  one code against a meshtk Go harness at period 120.

- **D-04 — Repeatable ledger `CtfScoreEvent` (CTFT-03)**
- New entity: `pk = challenge`, `sk = user#<bucket>`; GSI `byUser`. Attrs: `challenge`, `user`, `points`,
  `channel`, `scoredAt`, `tierCeiling`.
- A flag is **repeatable** when `answerType === "otp"` OR `perPlayerMax > 1` OR `perPlayerIntervalHours`
  is set → it writes `CtfScoreEvent`. Static one-award flags keep writing `CtfSolve` (unchanged).
- **Atomic once-per-window** (NOT query-then-append): `bucket` = floor of `scoredAt` to
  `perPlayerIntervalHours` (or the OTP period for tighter flags). The once-per-window guarantee is a
  **conditional put that collides atomically** (first writer in the window wins) — exactly like
  `CtfSolve`'s `attribute_not_exists`. No read-then-write race.
- Accrual (`RunUser.ctfScore`/`ctfSolves` via `accrue`) is per scoring event, exactly as today.

- **D-05 — Judge gates on `judgeSolve` (CTFT-04), ordered; every failure = indistinguishable non-solve**
1. Load + enabled (exists).
2. **Unlock gate**: if `unlockAfter` set and the player has no score for it → non-solve.
3. *(Scoring-window gate is Slice 2 — SKIP.)*
4. Rate-limit / anti-spam (exists).
5. **Answer validation by `answerType`**: `static` → `verifyAnswerHash` (exists); `otp` → `verifyTotp`
   (accept current period or within ±skew).
6. **Idempotency / cadence (atomic)**: one-award flags → existing `CtfSolve` conditional put; repeatable
   flags → conditional put on `CtfScoreEvent` keyed `user#<bucket>` (collision = already-scored-this-window
   non-solve); `perPlayerMax` via a per-`(challenge,user)` atomic count/counter; `globalMax` via the atomic
   `allocateOrdinal` ordinal (`n > globalMax` ⇒ award 0 / no accrue — **never** a partition query).
7. Score + accrue: `computePoints` → `recordScore` + `accrue` (unchanged).

- **D-06 — Effect-return plumbing (CTFT-05)**
- `judgeSolve` currently neither loads nor returns `effect`. 1a adds `effect` to the loaded `Ctf`
  (`narrowCtf`), to `JudgeResult`, and surfaces it on the **non-covert solve response ONLY**.
- New recognized `effect` kind: `{ kind: "otp-enroll", otpauth, nextFlag? }`. (The renderer is Slice 1b —
  1a only carries the payload out.)
- The covert CSS path (`covert-egg.ts`) stays **byte-identical** and carries NO reward payload.

- **D-07 — Edit-semantics guard (CTFT-06)**
- **Disallow flipping `answerType` static↔repeatable once solves exist** (history would split across
  `CtfSolve` + `CtfScoreEvent`). This is the spec's chosen resolution to the open item. Enforce at the
  write/validation boundary appropriate for this backend slice (the planner decides the exact seam;
  a data-layer guard is acceptable since the form is Slice 1b).

- **D-08 — Security hygiene (carry v2.1 invariants)**
- Never log the raw guess or the OTP secret. TOTP secret at rest is inherent to verification (documented;
  same trust level as meshtk — not a regression).
- OTP replay within a period is bounded by `perPlayerIntervalHours`.

### Claude's Discretion
- Exact ElectroDB key strings / index names for `CtfScoreEvent` (mirror the `CtfSolve`/`Ctf` conventions
  in `src/entities/qr.ts`; keep resolver key-parity if the resolver mirrors this entity).
- The precise seam for the `perPlayerMax` counter (per-`(challenge,user)` conditional-increment vs a
  `byUser` count) — pick the atomic option that fits the existing store seam.
- Test file organization and the injectable clock/store seams (follow the Phase 44 pattern:
  `computePoints` injectable clock, `judgeSolve` injectable `CtfStore`).
- Whether `wordlist` appears as an inert literal in the `answerType` union (no judge path either way in 1a).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (source of truth for this slice)
- `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md` — the approved,
  code-verified combined spec. Slice 1a = the "Build slices" §1a; read the code-verification corrections
  block at the top (effect channel unwired, TOTP source, QR reuse) and the Data-model / Judge / TOTP /
  Ledger sections.

### Existing CTF judge foundation (v2.1, present in this worktree — extend, do not rewrite)
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — `judgeSolve` (LOCKED 7-step flow), `JudgeResult`,
  `narrowCtf`, `allocateOrdinal`, `accrue`, `CtfSolve.create` conditional put. This is what 1a extends.
- `apps/run.human/webapp/src/entities/qr.ts` — the `Ctf` entity (`answerHash`, `solveCount`, `effect: any`),
  `CtfSolve`, `CtfPending`. New fields + `CtfScoreEvent` go here, mirroring these conventions.

### TOTP port source (UPSTREAM — not in this repo)
- `~/working/meshtk/pkg/otp/totp.go` — the Go RFC 6238/4226 core to port (`NewOTPHandler`, `GenerateTOTP`,
  `CalculateTOTPWithAdjacentPeriods`). ⚠️ It has NO verify/skew (build that new) and its default period is 120s.

### Covert-channel invariant (must stay byte-identical)
- `apps/run.human/webapp/src/lib/covert-egg.ts` (and the v2.1 covert-channel spec
  `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`) — the reward `effect` must
  NEVER reach this path.
</canonical_refs>

<specifics>
## Specific Ideas

- **Flagship user story (context for why these fields exist):** the seed→OTP daily chain. A Static flag
  `goldstein` whose reward reveals an OTP enrollment; a chained Rotating-OTP flag `goldstein-dawn`
  (hidden until `goldstein` is scored) accepts the rolling code once per 24h. Slice 1a builds every
  backend piece of this EXCEPT the time-of-day window (Slice 2) and the reveal UI (Slice 1b).
- The `otpauth` handed out is the downstream OTP flag's seed — the admin sets the same seed on both the
  seed flag's reward and the chained OTP flag (a Slice 1b/admin concern; 1a just carries the payload).
- Existing atomic patterns to reuse verbatim: `CtfSolve.create` `attribute_not_exists` (idempotent claim,
  `ctf-judge.ts:289-309`), `allocateOrdinal` `ADD Ctf.solveCount 1` (`ctf-judge.ts:311-316`),
  `accrue` `RunUser.patch().add({ctfScore, ctfSolves:1})` (`ctf-judge.ts:332-336`).
</specifics>

<deferred>
## Deferred Ideas

- **Slice 1b** — form redesign (`CtfForm.tsx`) + `otp-enroll` reward renderer (QR via `qrcode@^1.5.4`,
  already a run.human dep — rendered client-side; no `eqr` reuse).
- **Slice 2** — `scoreWindow` day/time/IANA-tz gating + "DEF CON run hours" (Thu–Sun 6–8 AM PT) chip.
- **Slice 3** — `CtfCode` wordlist entity + `wordlist` answer type (atomic single-use claim).
- **Later** — whether to unify `CtfSolve` + `CtfScoreEvent` (kept additive now to protect shipped static behavior).
- **Board visibility** of chained flags (hidden vs shown-locked) — default hidden until prerequisite scored;
  the board/UI decision lands with the frontend slices.
</deferred>

---

*Phase: 53-ctf-flag-types-slice-1a-backend*
*Context gathered: 2026-07-14 from the approved, code-verified design spec*
