---
phase: 57-ctf-form-qr-polish-dc33-seed-data
reviewed: 2026-07-15T18:36:11Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - apps/run.human/webapp/src/components/admin/qr-ui.ts
  - apps/run.human/webapp/src/components/admin/CtfForm.tsx
  - apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx
  - apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx
  - apps/run.human/webapp/src/lib/ctf-seed-rows.ts
  - apps/run.human/webapp/src/lib/__tests__/ctf-seed-rows.test.ts
  - apps/run.human/webapp/scripts/seed-ctf.mts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: resolved (CR-01 + WR-01/02 + IN-02 fixed; WR-03/IN-01/IN-03 deferred)
---

# Phase 57: Code Review Report

**Reviewed:** 2026-07-15T18:36:11Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 57 is a restyle of two shipped CTF components (`CtfForm`, `CtfOtpEnroll` + its `ClaimClient` mount) plus a new operator seed script (`seed-ctf.mts`) fed by a pure row-builder (`ctf-seed-rows.ts`).

The restyle work is clean and holds to its stated invariants:

- **Surface A (`CtfForm`):** The `onSave` payload, `applyPreset`/`presetToAdvanced`, `previewPoints`, `buildOtpAnswerField`, `formStateToScoreWindow` and the CR-01/WR-01/WR-02 guards from prior phases are all intact. Presets, live preview, and the `ctf_upsert` payload are unchanged — this is genuinely restyle-only.
- **Surface B (`CtfOtpEnroll`):** `qr.toDataURL` params are **byte-identical** to the D2 contract (width 220, margin 2, EC `M`, light `#ffffff` / dark `#000000`); the polish is an OUTER glow + border on the white quiet-zone wrapper only — modules/pupils are never touched. `parseOtpauth`, `adjacentCodesAsync`, the `isSupportedAlgorithm` fallback, the silent no-op on unparseable seed, the `aria-live` roll announcement, and the `nextFlag` prop are all preserved. The new gradient countdown bar is a correctly-labeled `role="progressbar"` (name + `aria-valuemin/max/now/valuetext`).
- **Seed script key safety:** The hand-composed `Ctf` pk/sk (`$run#challenge_<name>` / `$ctf_1`) is verified byte-identical to ElectroDB's output via `src/entities/__tests__/qr-key-parity.test.ts` (line 33), `__edb_e__="Ctf"` matches `migrate-ctf-answerhash.mts`, DRY-RUN is the default, and a real-row parity check runs before any write. Answers hash through the same `hashAnswer` seam the judge verifies against; every row is `enabled:false`; the goldstein→goldstein-otp chain (`unlockAfter` + matching `secret`) and the grace-hopper timed-drop tier are structurally correct.

**However**, there is one Critical defect: the seed rows populate the legacy **`points`** field and omit **`maxSolves`**, but the judge's scorer ignores `points` and returns 0 when `maxSolves` is absent. As a result **5 of the 6 seeded starter flags award 0 points on solve** — directly contradicting the D3 award contract. This is masked by the unit test (which asserts the ignored `points` field) and by `enabled:false`, so it will only surface when an admin enables a starter to use it.

## Critical Issues

### CR-01: Five of six seeded starter flags award 0 points (rely on the `points` field the judge ignores; omit `maxSolves`)

**File:** `apps/run.human/webapp/src/lib/ctf-seed-rows.ts:88-158`

**Issue:**
The judge never reads a `Ctf` row's `points` attribute. `narrowCtf` in `ctf-judge.ts:623-630` builds the `ScoringConfig` from `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus` only, defaulting each absent field to `0`. `computePoints` (`ctf-scoring.ts:76`) then does `if (n > ctf.maxSolves) return 0` as its FIRST step. With `maxSolves` defaulting to `0`, the first solver (`n = 1`) satisfies `1 > 0` and the flag returns **0 points** (and the judge marks it `capped: true`, `ctf-judge.ts:548`, so the player sees the "points are capped" message).

Tracing every seed row through the judge:

| flag | seed fields | judge `maxSolves` | award to 1st solver | D3 intent |
|------|-------------|-------------------|---------------------|-----------|
| `goldstein` | `points:100, pointMax:100` (no `maxSolves`) | 0 | **0** | flat 100 |
| `goldstein-otp` | `points:100` (no `pointMax`/`maxSolves`) | 0 | **0** | award on OTP |
| `mudge` | `pointMax:1000, pointFloor:100, maxSolves:100, firstBloodBonus:250` | 100 | 1250 ✓ | race |
| `condor` | `points:100` (no `pointMax`/`maxSolves`) | 0 | **0** | flat 100 |
| `grace-hopper` | `pointMax:100, pointFloor:1` (no `maxSolves`) | 0 | **0** | drop 500→1 |
| `turing` | `points:10` (no `pointMax`/`maxSolves`) | 0 | **0** | award 10 (confetti fires but 0 pts) |

Only `mudge` (the one row that sets `maxSolves`) scores. The `points` field is dead for scoring — `CtfForm` never even sends it (it sends `pointMax`/`maxSolves`/…), and the form presets always set `maxSolves` (e.g. `presetToAdvanced("flat-points")` → `maxSolves:100`, `easter-egg` → `maxSolves:1`). The seed rows diverged from that contract.

The unit test (`ctf-seed-rows.test.ts:79-83,101-106`) asserts `c.points === 100` / `t.points === 10`, which gives false confidence — it validates a field the judge discards and never exercises `computePoints`.

Mitigated only by `enabled:false`: the moment an admin enables one of these starters to demo/use it, it silently awards nothing.

**Fix:** Drop the ignored `points` field and set the real scoring knobs (`pointMax` + `pointFloor` + `maxSolves`) the judge consumes, mirroring the form presets. For the flat/egg starters:

```ts
// goldstein (flat 100) — every solver 100, effect chain preserved
{ challenge: "goldstein", answerType: "static", answerHash: hashAnswer("hackers4evr"),
  pointMax: 100, pointFloor: 100, maxSolves: 100, effect: { /* otp-enroll … */ },
  enabled: false, ...ANTI_SPAM },

// goldstein-otp (repeatable OTP award 100)
{ challenge: "goldstein-otp", answerType: "otp", otp: { /* … */ },
  unlockAfter: "goldstein", perPlayerIntervalHours: 24,
  pointMax: 100, pointFloor: 100, maxSolves: 100, enabled: false, ...ANTI_SPAM },

// condor (flat 100)
{ challenge: "condor", answerHash: hashAnswer("fr33k3v1n"),
  pointMax: 100, pointFloor: 100, maxSolves: 100, enabled: false, ...ANTI_SPAM },

// grace-hopper (timed drop: tier ceiling 500 → floor 1 over the curve)
{ challenge: "grace-hopper", answerHash: hashAnswer("d3bugth3sYstem"),
  pointMax: 100, pointFloor: 1, maxSolves: 100, timeTiers: [DEFCON_34_TIER],
  enabled: false, ...ANTI_SPAM },

// turing (easter egg award 10)
{ challenge: "turing", answerHash: hashAnswer("3n1gim@"),
  pointMax: 10, pointFloor: 10, maxSolves: 1, effect: { kind: "confetti", intensity: 11 },
  enabled: false, ...ANTI_SPAM },
```

Then update `ctf-seed-rows.test.ts` to assert the scoring fields (`pointMax`/`maxSolves`) and, ideally, add a parity test that runs each row through `computePoints(1, …)` and asserts a non-zero award for the intended-scoring starters. (If keeping `points` for display is desired, that is fine — but it must be *in addition to* the real scoring fields, not instead of them.)

## Warnings

### WR-01: `seed-ctf.mts --confirm` re-run silently resets `solveCount` and `createdAt` (full-item overwrite)

**File:** `apps/run.human/webapp/scripts/seed-ctf.mts:115-132,211-216`

**Issue:** `composeItem` hardcodes `solveCount: 0` and `createdAt: now`, and `doc.put` writes the ENTIRE item. The script advertises this as "idempotent — same key overwrites" (line 211), but a full `put` is not a safe upsert: re-running `--confirm` after an admin has enabled a starter and players have solved it will reset `solveCount` back to `0`, wipe `createdAt`, and revert `enabled`/any admin edits. Resetting `solveCount` corrupts the atomic ordinal allocator (`ADD solveCount 1 → n`), so subsequent solves re-issue ordinals 1,2,3… that already exist in `CtfSolve` (duplicate first-blood / duplicate ordinals).

**Fix:** Either (a) guard `--confirm` to skip/refuse rows that already exist with `solveCount > 0` (fetch each key first), or (b) use a conditional put / update that only writes when the item is absent, or (c) drop `solveCount`/`createdAt` from the composed item and let the attribute default apply only on first insert. At minimum, downgrade the "idempotent" claim in the header comment to note that a re-run clobbers live counters.

### WR-02: `--remove` deletes unconditionally — no dry-run, no guard against enabled/solved rows

**File:** `apps/run.human/webapp/scripts/seed-ctf.mts:201-209`

**Issue:** `--confirm` (write) is gated behind DRY-RUN, but `--remove` deletes immediately with no preview and no confirmation of what it is about to destroy. It deletes by composed key without checking whether the row is still the disabled seed. If an admin had enabled and used a starter (or independently created a real challenge that happens to share a seeded name — the names are real DC33 personas), `--remove` hard-deletes the live `Ctf` row, orphaning its `CtfSolve`/`CtfScoreEvent` rows and the players' scores that reference it. The delete is irreversible.

**Fix:** Make `--remove` print the target keys and require a second `--confirm` (mirroring `reset-ctf-user.mts`, which requires `--confirm` even for deletes), and/or fetch each row first and refuse to delete any with `enabled === true` or `solveCount > 0` unless a `--force` flag is passed.

### WR-03: `CtfForm` can save an OTP-answer flag with no secret on create → silently unsolvable

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:329-338,382-408`

**Issue:** The OTP secret is parsed/validated only when `otpSecretTrimmed !== ""` (line 331). On **create** with `answerType === "otp"` and a blank OTP field, no `otpField` is built and no inline error is raised, so the row persists as `answerType: "otp"` with no `otp.secret`. The judge's OTP path then has nothing to verify against and the flag can never be solved — the exact "persist an unsolvable flag" failure the sibling CR-01 guard (line 324-338) was added to prevent, just on the create-with-blank path instead of the malformed path. (On edit, blank correctly means "keep the stored secret," so the guard should be create-only.)

**Fix:** In `onSave`, when `answerType === "otp"` and this is a create (`!isEdit`) with `otpSecretTrimmed === ""`, reject with an inline error, e.g.:

```ts
if (answerType === "otp" && !isEdit && otpSecretTrimmed === "") {
  setError("A Rotating-OTP flag needs an otpauth:// secret.");
  return;
}
```

## Info

### IN-01: `ClaimClient` sets the `ctf_pending` nonce cookie without `SameSite`/`Secure`

**File:** `apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx:31`

**Issue:** `document.cookie = \`ctf_pending=${nonce}; path=/; max-age=…\`` sets no `SameSite` or `Secure` attribute. The claim nonce is low-risk (it only re-associates an already-captured anonymous flag with the now-authenticated user, over HTTPS/CloudFront), but best practice is to scope the cookie. This is ported behavior, not introduced by the restyle.

**Fix:** Append `; SameSite=Lax; Secure` to the cookie string (both set and clear).

### IN-02: `fetchOneCtfRow` leaves a dangling 5s timer that delays DRY-RUN exit

**File:** `apps/run.human/webapp/scripts/seed-ctf.mts:141-156`

**Issue:** `Promise.race([scan, timeout])` never clears the `setTimeout(…, 5000)` when the scan wins, so the timer keeps the Node event loop alive and the DRY-RUN process lingers up to ~5s after printing its output before exiting. Cosmetic only.

**Fix:** Capture the timer id and `clearTimeout` it in a `finally`, or `unref()` the timeout.

### IN-03: Seed script hardcodes ElectroDB's key format (drift risk)

**File:** `apps/run.human/webapp/scripts/seed-ctf.mts:115-136`

**Issue:** `composeItem`/`keyOf` reproduce ElectroDB's `$run#challenge_<x>` / `$ctf_1` and the `__edb_e__`/`__edb_v__` markers by hand. The `Ctf` entity's own header (`src/entities/qr.ts:15-26`) flags this format as "LOAD-BEARING." If `model.service`/`version` ever change, the script writes to the wrong keys silently. This is the accepted D4 design and is mitigated by the mandatory DRY-RUN parity print against a real row — but the safety net is a manual eyeball, not an assertion.

**Fix (optional):** Have DRY-RUN hard-fail (non-zero exit) when the composed pk/sk does not match the fetched real row's key shape, so a drift is caught mechanically before `--confirm`.

---

_Reviewed: 2026-07-15T18:36:11Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
