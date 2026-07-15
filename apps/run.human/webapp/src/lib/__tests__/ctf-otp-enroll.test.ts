import { describe, it, expect } from "vitest";

import { asOtpEnrollEffect } from "../ctf-otp-enroll";

/**
 * A well-formed otpauth:// enrollment URL (parseOtpauth accepts it): totp type,
 * a valid base32 secret, meshtk defaults. This is the payload a chained
 * rotating-OTP flag hands the solver.
 */
const VALID_OTPAUTH =
  "otpauth://totp/Defcon.run:runner?secret=JBSWY3DPEHPK3PXP&issuer=Defcon.run&digits=6&period=120";

describe("asOtpEnrollEffect", () => {
  it("returns the narrowed effect for a valid otp-enroll payload", () => {
    const effect = { kind: "otp-enroll", otpauth: VALID_OTPAUTH };
    expect(asOtpEnrollEffect(effect)).toEqual({
      kind: "otp-enroll",
      otpauth: VALID_OTPAUTH,
    });
  });

  it("carries nextFlag through when present", () => {
    const effect = {
      kind: "otp-enroll",
      otpauth: VALID_OTPAUTH,
      nextFlag: "day-2-drop",
    };
    expect(asOtpEnrollEffect(effect)).toEqual({
      kind: "otp-enroll",
      otpauth: VALID_OTPAUTH,
      nextFlag: "day-2-drop",
    });
  });

  it("drops a non-string nextFlag (keeps the otpauth reward valid)", () => {
    const effect = {
      kind: "otp-enroll",
      otpauth: VALID_OTPAUTH,
      nextFlag: 42,
    };
    const narrowed = asOtpEnrollEffect(effect);
    expect(narrowed).not.toBeNull();
    expect(narrowed?.nextFlag).toBeUndefined();
  });

  it("returns null for a wrong kind", () => {
    expect(
      asOtpEnrollEffect({ kind: "confetti", otpauth: VALID_OTPAUTH }),
    ).toBeNull();
  });

  it("returns null when otpauth is missing", () => {
    expect(asOtpEnrollEffect({ kind: "otp-enroll" })).toBeNull();
  });

  it("returns null for an empty-string otpauth", () => {
    expect(asOtpEnrollEffect({ kind: "otp-enroll", otpauth: "" })).toBeNull();
  });

  it("returns null for a non-string otpauth", () => {
    expect(
      asOtpEnrollEffect({ kind: "otp-enroll", otpauth: 12345 }),
    ).toBeNull();
  });

  it("returns null for an unparseable otpauth (never throws)", () => {
    expect(
      asOtpEnrollEffect({ kind: "otp-enroll", otpauth: "not-a-valid-url" }),
    ).toBeNull();
    // Right scheme, but no secret → parseOtpauth throws → narrowed to null.
    expect(
      asOtpEnrollEffect({
        kind: "otp-enroll",
        otpauth: "otpauth://totp/label?digits=6",
      }),
    ).toBeNull();
    // hotp (wrong type) → parseOtpauth throws → null.
    expect(
      asOtpEnrollEffect({
        kind: "otp-enroll",
        otpauth: "otpauth://hotp/label?secret=JBSWY3DPEHPK3PXP",
      }),
    ).toBeNull();
  });

  it("returns null for null / undefined / non-object inputs", () => {
    expect(asOtpEnrollEffect(null)).toBeNull();
    expect(asOtpEnrollEffect(undefined)).toBeNull();
    expect(asOtpEnrollEffect("otp-enroll")).toBeNull();
    expect(asOtpEnrollEffect(42)).toBeNull();
    expect(asOtpEnrollEffect(true)).toBeNull();
    expect(asOtpEnrollEffect([])).toBeNull();
  });
});
