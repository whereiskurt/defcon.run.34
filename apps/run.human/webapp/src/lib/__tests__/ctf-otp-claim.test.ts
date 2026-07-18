/**
 * ctf-otp-claim.test.ts — PURE unit tests for the single-use OTP claim/identity/TTL
 * logic (Phase 65). Runtime-pure: no ElectroDB, no AWS. Proves SC1 (first-come
 * single-use gate) and SC3 (code-keyed identity across skew offsets + TTL) at the
 * pure-logic layer, before the judge (65-02) wires the atomic store op.
 *
 * Never references a raw OTP code in a way that could leak it; codes here are
 * arbitrary strings standing in for rolling TOTP codes.
 */
import { describe, it, expect } from "vitest";
import { hashAnswer } from "@/lib/ctf-hash";
import {
  otpCodeHash,
  otpClaimTtlSeconds,
  applyOtpClaim,
  resolveOtpClaimOutcome,
} from "@/lib/ctf-otp-claim";

describe("otpCodeHash — stable code identity (SC3)", () => {
  it("is deterministic and equals the salted hashAnswer seam", () => {
    expect(otpCodeHash("123456")).toBe(otpCodeHash("123456"));
    expect(otpCodeHash("123456")).toBe(hashAnswer("123456"));
  });

  it("maps different codes to different identities", () => {
    expect(otpCodeHash("123456")).not.toBe(otpCodeHash("654321"));
  });
});

describe("otpClaimTtlSeconds — auto-expiring consumed marker (SC3)", () => {
  const NOW_MS = 1_700_000_000_000; // fixed epoch ms
  const NOW_S = Math.floor(NOW_MS / 1000);

  it("applies meshtk defaults (period 120, skew 1) when otp omits them", () => {
    expect(otpClaimTtlSeconds(NOW_MS)).toBe(NOW_S + 120 * (1 + 2));
    expect(otpClaimTtlSeconds(NOW_MS, {})).toBe(NOW_S + 120 * (1 + 2));
  });

  it("honors explicit period/skew", () => {
    expect(otpClaimTtlSeconds(NOW_MS, { period: 30, skew: 2 })).toBe(
      NOW_S + 30 * (2 + 2)
    );
  });

  it("treats a zero/absent period as the 120s default", () => {
    expect(otpClaimTtlSeconds(NOW_MS, { period: 0 })).toBe(NOW_S + 120 * (1 + 2));
    expect(otpClaimTtlSeconds(NOW_MS, { skew: 0 })).toBe(NOW_S + 120 * (0 + 2));
  });
});

describe("applyOtpClaim — create-if-absent first-wins/second-loses (SC1)", () => {
  it("first claimer of a code wins; a second (different user, same code) loses", () => {
    const claims = new Map<string, { claimedBy: string }>();
    const code = otpCodeHash("111111");

    const first = applyOtpClaim(claims, code, "u1");
    expect(first).toEqual({ claimed: true });

    const second = applyOtpClaim(claims, code, "u2");
    expect(second).toEqual({ claimed: false, claimedBy: "u1" });
  });

  it("the winner re-submitting the SAME code loses (no double claim)", () => {
    const claims = new Map<string, { claimedBy: string }>();
    const code = otpCodeHash("222222");
    expect(applyOtpClaim(claims, code, "u1")).toEqual({ claimed: true });
    // Same user, same code again → row exists → claimed:false (no double-award).
    expect(applyOtpClaim(claims, code, "u1")).toEqual({
      claimed: false,
      claimedBy: "u1",
    });
  });

  it("a different code is an independent claim either user can win", () => {
    const claims = new Map<string, { claimedBy: string }>();
    expect(applyOtpClaim(claims, otpCodeHash("333333"), "u1")).toEqual({
      claimed: true,
    });
    expect(applyOtpClaim(claims, otpCodeHash("444444"), "u2")).toEqual({
      claimed: true,
    });
  });
});

describe("resolveOtpClaimOutcome — the gate decision", () => {
  it("won claim credits; lost claim is an indistinguishable non-solve", () => {
    expect(resolveOtpClaimOutcome({ claimed: true })).toBe("credit");
    expect(resolveOtpClaimOutcome({ claimed: false })).toBe("non-solve");
  });
});
