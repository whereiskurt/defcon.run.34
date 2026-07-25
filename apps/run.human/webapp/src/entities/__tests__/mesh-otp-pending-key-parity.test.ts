import { describe, it, expect } from "vitest";
import { meshOtpPendingKeyFor } from "../mesh-otp-pending";

/**
 * LOCKED cross-language contract with meshtk's internal/otpqueue package
 * (key_parity_test.go). The Go poller composes these strings BY HAND to Query
 * and Delete queue items — any drift here silently strands every OTP delivery.
 * Same fixture nodeId as mesh-radio-key-parity.test.ts.
 */
describe("MeshOtpPending key parity (LOCKED)", () => {
  it("composes the exact queue pk/sk meshtk's otpqueue package expects", () => {
    const { pk, sk } = meshOtpPendingKeyFor("!433d1cec");
    expect(pk).toBe("$run#queue_otp");
    expect(sk).toBe("$meshotppending_1#nodeid_!433d1cec");
  });
});
