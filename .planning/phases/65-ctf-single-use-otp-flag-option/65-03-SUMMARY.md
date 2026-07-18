# 65-03 SUMMARY — admin single-use toggle + write/redaction passthrough

**Status:** Complete
**Requirements:** CTFT-18, CTFT-15 (admin half)

## What shipped
- `lib/qr-admin.ts` — `InputCtf.otp.singleUse?: boolean`. The existing verbatim
  whole-`otp`-map passthrough (`...(input.otp !== undefined ? { otp: input.otp } : {})`)
  persists it unchanged — no separate emit/transform.
- `components/admin/ctf-form-model.ts` — `singleUse` added to `OtpAnswerField`,
  `LoadedCtfRecord.otp`, and `RedactedCtfRecord.otp`; `redactCtfSecrets` copies
  `singleUse` (NON-SECRET, like digits/period) into the OTP summary while still
  stripping `secret`.
- `components/admin/CtfForm.tsx` — `otpSingleUse` state (rehydrated from
  `initial?.otp?.singleUse`); a labeled default-off checkbox in the Rotating-OTP
  section (3b); merged into the posted otp payload
  (`{ ...buildOtpAnswerField(secret), singleUse: otpSingleUse }`).

## Known edit limitation (documented inline)
The otp map is sent WHOLE and only when a new secret is (re)entered (no-clobber), so
changing `singleUse` on an EXISTING flag requires re-entering the OTP secret — the
SAME rule the secret already follows. New flags / any OTP-config edit carry it
correctly. A server-side partial otp-map merge was deliberately kept out of scope.

## Tests (100 green across the two files)
- `lib/__tests__/qr-admin.test.ts` (+2): `ctfAttributes` emits `otp.singleUse`
  verbatim; no-otp input still omits otp.
- `components/admin/__tests__/ctf-form-model.test.ts` (+2 incl. fixture): redaction
  preserves `otp.singleUse` into the summary (secret still stripped, hasOtpSecret
  true); default-off preserved as `undefined`.
- `CtfForm.tsx` verified via `tsc --noEmit` (no new errors) — thin glue over the
  tested passthrough.

## Verify
`nvm use 22.12.0 && npx vitest run src/lib/__tests__/qr-admin.test.ts src/components/admin/__tests__/ctf-form-model.test.ts` → 100 passed.
`npx tsc --noEmit` → no new errors on `qr-admin.ts` / `ctf-form-model.ts` / `CtfForm.tsx`.
