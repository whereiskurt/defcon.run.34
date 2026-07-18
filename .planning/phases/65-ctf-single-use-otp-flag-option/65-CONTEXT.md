# Phase 65: CTF Single-Use OTP Flag Option (Judge-Enforced First-Come Claim) - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Auto-generated from the authoritative design spec (discuss skipped)

<domain>
## Phase Boundary

Add a per-flag `otp.singleUse` toggle so a rotating-OTP CTF flag can be
**first-come-first-served** (the FIRST logged-in player to redeem a given code
wins globally; everyone else gets a NON_SOLVE) instead of the current **shared**
behavior (every player who submits the same valid code within its skew window
scores independently). Default `false`/absent = today's shared behavior — no
migration, no shipped-flag change. Single-use is enforced **only in the judge**
(`run.human` `/ctf/claim` → `judgeSolve`, post-login); the public `q.defcon.run`
resolver Lambda is never touched.

**Authoritative design spec:** `docs/superpowers/specs/2026-07-18-single-use-otp-ctf-design.md`
— read it first. It carries the code map, edge cases, and the TDD plan.

**Requirements (from ROADMAP Phase 65):**
- **CTFT-15** — config flag: add `singleUse?: boolean` to the `otp` map in
  `Ctf.otp` (`qr.ts` entity), `JudgeOtp` (`ctf-judge.ts`), `CtfSeedOtp`
  (`ctf-seed-rows.ts`), and the admin form model. Default `false` ⇒ shared.
- **CTFT-16** — new lightweight `CtfOtpClaim` ElectroDB entity (`pk=challenge`,
  `sk=codeHash`; attrs `claimedBy`, `claimedAt`, `ttl` [DynamoDB TTL]). The
  single-use claim is a **create-if-absent** conditional put
  (`attribute_not_exists(pk)`) — exactly one concurrent claimer wins, no
  read-then-write race. Plus a **runtime-pure** claim/identity helper module
  (type-only entity imports, mirroring `ctf-solve-merge.ts`) so the pure logic
  unit-tests without the ElectroDB chain.
- **CTFT-17** — judge single-use OTP path in `judgeSolve`: when `otp.singleUse`
  and `verifyTotp` passes, compute `codeHash = hashAnswer(guess)`, perform the
  global atomic claim, award the winner through the existing
  `recordScoreEvent`/`accrue` path keyed `bucket=codeHash`, and set the claim-row
  TTL to `now + period·(skew+2)`. A lost/consumed code ⇒ NON_SOLVE
  indistinguishable from a wrong answer. Judge-only; never log guess/codeHash.
- **CTFT-18** — admin form toggle for `singleUse` in the Rotating-OTP section
  (default off).
</domain>

<decisions>
## Implementation Decisions

### HARD CONSTRAINT (the whole point — non-negotiable)
Single-use enforcement MUST live in the judge (`judgeSolve`), which only runs for
a credentialed `session.user.id`. It MUST NOT live in the public `q.defcon.run`
resolver Lambda. Rationale: the resolver is public/unauthenticated — a claim
write there would let an anonymous bot consume codes without logging in (DoS on
legit players + uncontrolled DDB write cost on public traffic). Zero DDB writes
from public traffic; the resolver stays a dumb stateless 302. **Do not touch the
resolver Lambda or any `.mjs` mirror.** `CtfOtpClaim`, like `CtfScoreEvent`/
`CtfCode`, has NO resolver `.mjs` mirror.

### Hard invariants (non-negotiable)
- **Global atomic claim keyed by CODE, not user/time-bucket.** `codeHash =
  hashAnswer(guess)` (salted via the existing `ctf-hash` seam; raw code never
  stored). Keying by `codeHash` — not a `floor(now/period)` time bucket — means
  the same physical 6-digit code is ONE claim even when two players straddle a
  step boundary and match via different skew offsets. The claim is a
  create-if-absent conditional put on `(challenge, codeHash)`; the FIRST writer
  wins, a second writer's condition fails ⇒ NON_SOLVE.
- **Default-off / no migration.** `otp.singleUse` absent or `false` ⇒ the
  existing repeatable OTP path (`scoreBucket` time-bucket + per-player
  `claimScoreEvent`) is unchanged, so every shipped flag (incl. `didhtp1`,
  `*-otp`) keeps scoring shared. Prove this with a regression test.
- **Indistinguishable NON_SOLVE.** A lost/consumed code returns the SAME
  NON_SOLVE shape + same `"no-solve"` log a wrong code yields (no info leak;
  covert-channel invariant T-53-04-01 intact). The covert CSS path
  (`covert-egg.ts`) stays byte-identical. Never pass guess/codeHash to the logger.
- **DynamoDB TTL** on the claim row: `ttl = floor(now/1000) + period·(skew+2)`
  seconds. The code is invalid past its window anyway (`verifyTotp` fails), so
  the consumed-code marker auto-expires — no cleanup job, no storage creep.
- **Never-throw contract** preserved: any store/validation error degrades to
  NON_SOLVE (mirror `claimSolve`/`claimScoreEvent`/`claimCode` catch discipline).
- **Runtime-pure test seam:** the pure claim/identity logic goes in a module with
  `import type` only (no ElectroDB/AWS chain), unit-tested offline exactly like
  `ctf-solve-merge.ts` / `ctf-seed-rows.ts`. The ElectroDB `CtfOtpClaim` op lives
  behind the injectable `CtfStore` seam so `judgeSolve` tests use an in-memory fake.

### Chosen shape (spec option A — preferred)
The spec offers two shapes; **(A) is chosen**: a fresh tiny `CtfOtpClaim` entity
(not overloading pool-oriented `CtfCode`, which is patch-if-exists and has no
TTL). New store op `claimOtpCode({ challenge, codeHash, user, claimedAt, ttl })`
→ `{ claimed, claimedBy? }`, implemented as `CtfOtpClaim.create(...)` (ElectroDB
`create` adds `attribute_not_exists` on the key ⇒ conditional put). On a condition
failure, read the existing row: present ⇒ `{claimed:false, claimedBy}`; absent ⇒
rethrow (degrade to NON_SOLVE), mirroring `claimSolve`. NOTE: `CtfCode.claimCode`
is a **patch-if-exists** (pre-loaded pool) — single-use OTP has NO pre-loaded
pool, so it needs **create-if-absent**, hence a distinct op/entity.

### Judge wiring
Place a dedicated **single-use OTP finalize block BEFORE the generic
`isRepeatable(ctf)` block** (mirroring how the wordlist finalize is placed first),
guarded by `ctf.answerType === "otp" && ctf.otp?.singleUse === true`. It runs
AFTER the shared step-4 `verifyTotp` gate (so an invalid code is still an
indistinguishable non-solve before any claim). Flow: compute `codeHash` →
`claimOtpCode` → if `!claimed` NON_SOLVE → else `allocateOrdinal` → `globalMax`
check → `computePoints` → `recordScoreEvent({ bucket: codeHash })` → `accrue` →
return credited solve (carry `effect` only when `points > 0`). This reuses the
existing wordlist-finalize scoring shape verbatim.

### Gray areas — decisions made (planner: honor these; flag only if code disproves)
- **Winner re-submits the same code (within its window):** `claimOtpCode` returns
  `claimed:false` (row exists) → NON_SOLVE. This means NO double-accrue (the core
  correctness the spec demands: "not a second consumption") and is CONSISTENT with
  the existing repeatable OTP path, which already returns NON_SOLVE on a
  same-window re-submit. The spec's "return prior award" wording is a nicety;
  matching the established repeatable behavior (NON_SOLVE, no double consumption)
  is simpler and safe. Do NOT call `accrue` a second time under any path.
- **`perPlayerMax` / `perPlayerIntervalHours` on a single-use flag:** the
  single-use path does NOT apply the time-bucket/`perPlayerMax` gates (mirrors the
  wordlist finalize) — a globally single-use code IS the natural bound. If a flag
  sets `perPlayerMax`, it's honored only insofar as each code is one global win;
  no per-player byUser count gate is added on this path. (Keep it simple; revisit
  only if a concrete flag needs it.)
</decisions>

<code_context>
## Existing Code Insights — anchors (all under `apps/run.human/webapp/src`)

- `entities/qr.ts` — `Ctf.otp` map (`:143`): add `singleUse: { type: "boolean" }`.
- `entities/ctf.ts` — home of `CtfSolve`/`CtfScoreEvent`/`CtfCode`; add the new
  `CtfOtpClaim` entity here (`pk=challenge`, `sk=codeHash`; `claimedBy`,
  `claimedAt`, `ttl`) + its `CtfOtpClaimItem` type. NO resolver `.mjs` mirror.
  Follow `CtfCode` verbatim, plus a `ttl` number attribute for DynamoDB TTL.
- `lib/ctf-judge.ts` — `JudgeOtp` (`:94`, add `singleUse?: boolean`); `narrowCtf`
  otp coercion (`:594`, carry `singleUse` through); `CtfStore` interface (add
  optional `claimOtpCode?`); `defaultStore` (implement `claimOtpCode` via
  `CtfOtpClaim.create` + catch discipline); the single-use finalize block in
  `judgeSolve` before `isRepeatable` (`~:447`). The wordlist finalize (`:422`) and
  `claimCode` (`:797`) are the closest analogs — read them first.
- `lib/ctf-hash.ts` — `hashAnswer` (salted SHA-256, `CTF_ANSWER_SALT`); the
  code-identity seam. `normalizeAnswer` trims+lowercases — numeric OTP codes are
  unaffected, but keep normalization identical to how a guess is hashed elsewhere.
- `lib/ctf-flag-types.ts` — `isRepeatable` already returns true for any `otp`
  flag; the single-use path branches off BEFORE the generic repeatable block, so
  no change needed here (single-use is still "repeatable" in the routing sense but
  handled by its own finalize).
- `lib/ctf-seed-rows.ts` — `CtfSeedOtp` (`:32`, add `singleUse?: boolean`).
- `components/admin/ctf-form-model.ts` + `CtfForm.tsx` — Rotating-OTP section;
  add the `singleUse` toggle (default off) + carry it through the model → write.
- `lib/qr-admin.ts` — the admin write passthrough for the `otp` map (verify
  `singleUse` is carried on upsert, like the other otp fields).
- Tests live in `lib/__tests__/ctf-judge*.test.ts` (+ `ctf-flag-types`,
  `ctf-seed-rows`, entity key-parity). vitest needs `npm ci` + `nvm use 22.12.0`
  (NOT 22.1.0 / 23.6.0).
</code_context>

<specifics>
## Specific Ideas — TDD (from the spec Testing §)

1. **Pure claim/identity logic** in a runtime-pure module: same code → same
   `codeHash`; the single-use gate returns win for the first claimer, NON_SOLVE
   for the second. Type-only entity imports; no ElectroDB.
2. **Judge tests** (inject a fake `CtfStore`): first claim wins + awards; second
   (different user, same code) → NON_SOLVE; winner re-submit → NON_SOLVE, no
   double-accrue. **Concurrency/race** proof: two claimers of the same code →
   exactly one win. **Regression:** a shared (non-`singleUse`) OTP flag still
   credits MULTIPLE users for the same code (default-off path unchanged).
3. **Resolver untouched** gate: assert no change to the resolver Lambda / `.mjs`
   mirrors (grep/no-diff) — single-use is judge-only.
4. **Covert invariant** regression stays green; static/otp/wordlist unaffected.
</specifics>

<deferred>
## Deferred Ideas

- Admin UI surfacing "consumed" state / who won a given code (nice-to-have; out
  of scope).
- Whether the winner-re-submit should echo the prior award instead of NON_SOLVE
  (spec nicety; deferred — see the gray-area decision above).
- Seeding a concrete single-use flag (operator/seed-script task, post-merge).
</deferred>
