---
phase: 54-ctf-flag-types-slice-1b-frontend-admin-form-redesign-otp-enr
reviewed: 2026-07-15T06:36:21Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - apps/run.human/webapp/src/components/admin/ctf-form-model.ts
  - apps/run.human/webapp/src/components/admin/CtfForm.tsx
  - apps/run.human/webapp/src/components/admin/qr-ui.ts
  - apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx
  - apps/run.human/webapp/src/lib/ctf-otp-core.ts
  - apps/run.human/webapp/src/lib/ctf-otp-client.ts
  - apps/run.human/webapp/src/lib/ctf-otp-enroll.ts
  - apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx
  - apps/run.human/webapp/src/app/(protected)/admin/qr/ctf/[challenge]/page.tsx
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 54: Code Review Report

**Reviewed:** 2026-07-15T06:36:21Z
**Depth:** deep
**Files Reviewed:** 7 source (+2 test/model helpers cross-checked)
**Status:** issues_found

## Summary

Reviewed the Slice-1b frontend: the pure form-model seam (`ctf-form-model.ts`),
the redesigned `CtfForm`, the browser TOTP core/client (`ctf-otp-core.ts`,
`ctf-otp-client.ts`), the reward narrowing gate (`ctf-otp-enroll.ts`), the
`CtfOtpEnroll` reveal renderer, the `ClaimClient` dispatch wiring, and the edit-page
redaction.

The security-critical pieces hold up well and are the strong part of this phase:

- **Redaction is sound (whitelist, not blacklist).** `redactCtfSecrets` rebuilds a
  fresh object from an explicit allow-list, so `otp.secret`, `effect`, and any
  unexpected secret-bearing field are dropped by construction. The edit page now
  routes the loaded row through it before it crosses to the client — a genuine
  security fix over the prior `record as CtfRecord` full-row pass-through.
- **Covert channel stays reward-free.** The reward renderer is imported only by the
  visible `ClaimClient`/admin preview, never by covert modules, and rendering is
  gated on `result.solved && result.points > 0`. The author-time invariant test
  backs this.
- **TOTP parity** (base32 decode, big-endian counter, RFC-4226 truncation) is
  shared between the node and Web-Crypto paths via one audited core, and the
  countdown effect cleans up its interval on unmount with an `alive` guard.

One BLOCKER breaks the Rotating-OTP answer type end-to-end, plus two robustness
warnings and two informational notes.

The two known pre-existing `tsc` errors (`header/dropdown-user.tsx`,
`entities/__tests__/checkin.test.ts`) are out of scope and not counted here.

## Critical Issues

### CR-01: Rotating-OTP secret is stored as the raw `otpauth://` URL the field asks for, but the judge base32-decodes it — OTP-answer flags can never be solved

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:244-267` (send), `:459-469` (field label/placeholder)

**Issue:**
The new Rotating-OTP answer type introduced in this phase collects the secret
through a field labeled **"OTP secret (otpauth://)"** with placeholder
`otpauth://totp/...`, i.e. it instructs the admin to paste a full otpauth URL. On
save the form sends that value verbatim:

```ts
const otpSecretTrimmed = otpSecret.trim();
...
...(otpSecretTrimmed !== "" ? { otp: { secret: otpSecretTrimmed } } : {}),
```

The server stores `input.otp` verbatim (`qr-admin.ts:366` →
`...(input.otp !== undefined ? { otp: input.otp } : {})`), and the judge verifies
with `verifyTotp(otp.secret ?? "", guess, ...)` (`ctf-judge.ts:304`), which runs
`base32Decode(secret)` on it. `base32Decode` upper-cases and then rejects any
character outside the RFC-4648 alphabet — an `otpauth://...` string contains `:`
and `/`, so it throws `invalid base32 character`, `verifyTotp` catches and returns
`false`. **No path anywhere parses the otpauth URL to extract the base32 secret**
(confirmed: the only `parseOtpauth` callers are the reward renderer and the type
narrowers; the server `upsertCtf`/`ctfAttributes` does not parse it).

Net effect: following the field's own instructions produces an OTP flag whose
answer can never verify for any runner. This also breaks the intended chained
flow (a static flag's `otp-enroll` reward hands out an `otpauth://` URL, and the
downstream Rotating-OTP flag is supposed to verify codes from that same secret —
but that secret is base32, not the URL). Digits/period from the URL are likewise
lost (the form sends only `{ secret }`), so verification silently falls back to
the 6-digit / 120s defaults even when the enrollment URL specified otherwise.

**Fix:** Parse the otpauth URL in the form (the client-safe `parseOtpauth` from
`@/lib/ctf-otp-core` is already imported elsewhere in this phase) and send the
extracted base32 secret plus digits/period — rejecting non-otpauth input:

```ts
// in onSave(), replacing the raw passthrough:
let otpField: { secret: string; digits?: number; period?: number } | undefined;
if (otpSecretTrimmed !== "") {
  try {
    const cfg = parseOtpauth(otpSecretTrimmed);
    otpField = { secret: cfg.secret, digits: cfg.digits, period: cfg.period };
  } catch {
    setError("OTP secret must be a valid otpauth:// URL.");
    return;
  }
}
// ...
...(otpField ? { otp: otpField } : {}),
```

Alternatively, relabel the field to accept a bare base32 secret — but that
diverges from the reward side, which does use full otpauth URLs; parsing is the
consistent choice.

## Warnings

### WR-01: Reward `otpauth://` (and OTP secret) are never validated before save — malformed input persists silently with no admin feedback

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:217-238`

**Issue:**
`rewardActive` only checks `rewardOtpauth.trim() !== ""`; the value is composed
into `effect = { kind: "otp-enroll", otpauth: rewardOtpauth.trim() }` and saved
without ever calling `parseOtpauth`/`asOtpEnrollEffect`. A typo'd or non-otpauth
string is stored happily. On the player side `asOtpEnrollEffect` then rejects it
and the reward card silently renders nothing — the admin gets no signal that the
reward they configured will never appear. The "Reveal preview" affordance is
optional and easy to skip. (Same class of gap underlies CR-01 for the OTP-answer
secret.)

**Fix:** Validate before save and surface an error, e.g.:

```ts
if (rewardActive && asOtpEnrollEffect({ kind: "otp-enroll", otpauth: rewardOtpauth.trim() }) === null) {
  setError("Reward otpauth:// is not a valid enrollment URL.");
  return;
}
```

### WR-02: Client TOTP hard-codes SHA1 and discards the parsed algorithm — a non-SHA1 `otpauth` reveals no codes with no explanation

**File:** `apps/run.human/webapp/src/lib/ctf-otp-client.ts:42-53`, `apps/run.human/webapp/src/components/ctf/CtfOtpEnroll.tsx:93`

**Issue:**
`totpAtAsync` sets `algorithm = DEFAULT_ALGORITHM` unconditionally and `CtfOtpEnroll`
calls `adjacentCodesAsync(secret, now, { digits, period })` without passing
`parsed.algorithm`. If an enrollment URL declares `algorithm=SHA256`, the switch
throws `unsupported algorithm`, the `tick` catch swallows it, and the rolling code
just stays `······` forever while the QR still renders — a confusing half-broken
reveal. The server `totpAt` shares the same SHA1-only limitation (tracked as the
deferred phase-53 WR-03), so parity is preserved, but the client compounds it by
silently no-op'ing rather than degrading visibly.

**Fix:** Either thread `parsed.algorithm` through `adjacentCodesAsync`/`totpAtAsync`
and implement SHA-256/512 (Web Crypto `"SHA-256"`/`"SHA-512"`), or, until then,
detect a non-SHA1 `parsed.algorithm` in `CtfOtpEnroll` and render a "codes
unavailable for this algorithm" note instead of a permanent placeholder.

## Info

### IN-01: `hasEffect` keep-hint on the reward field is shown for any effect kind, not just `otp-enroll`

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:417-421`

**Issue:** When editing a flag whose stored `effect` is unrelated (e.g. a
`confetti` effect), `initial?.hasEffect` is still true, so enabling the reward
section shows the placeholder `"•••••• (set — leave blank to keep)"` on the
reward otpauth field, implying an OTP reward is already configured when it is not.
`hasEffect` is a generic "an effect exists" flag and cannot distinguish kinds
(the kind was redacted away). Cosmetic/misleading only; no data is clobbered
(blank reward + blank effect keeps the stored effect).

**Fix:** Consider carrying a redaction-safe `effectKind` hint (kind string only,
no payload) so the keep-hint is scoped to actual `otp-enroll` effects, or soften
the copy to "an effect is configured".

### IN-02: Live-preview shows `First solve = 0` whenever `Max solves` is blank

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:783-785`, `ctf-form-model.ts:139-142`

**Issue:** `nMax` defaults blank `maxSolves` to `1` (`numOrUndef(maxSolves) ?? 1`)
for the display index, but `previewPoints` maps blank `maxSolves` to `0`
(`toNum(...) ?? 0`), and `computePoints` returns `0` for `n(1) > maxSolves(0)`.
So a freshly-created custom flag with `Max solves` still empty shows a `+0` first
solve. This is faithful to what the judge would actually award (an unset cap
scores nothing), so it is arguably correct, but it can read as a broken preview.
Not a defect on its own — flagged so the intended default is deliberate.

**Fix:** If a blank cap should preview as "unlimited/one" rather than 0, coerce
`maxSolves` consistently in both the preview index and the scoring config (e.g.
default both to `1`), matching whatever the judge does on save for a blank cap.

---

_Reviewed: 2026-07-15T06:36:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
