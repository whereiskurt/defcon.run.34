import { describe, it, expect } from "vitest";
import { meshWelcomePendingKeyFor } from "../mesh-welcome-pending";

/**
 * LOCKED cross-language contract with meshtk's internal/otpqueue welcome-item
 * classification (key_parity_test.go). Welcome items share the OTP queue's
 * physical partition (pk carries no entity name) and are told apart by this
 * sk prefix — drift strands every welcome DM. Same fixture as the other locks.
 */
describe("MeshWelcomePending key parity (LOCKED)", () => {
  it("shares the queue partition with a welcome-scoped sk", () => {
    const { pk, sk } = meshWelcomePendingKeyFor("!433d1cec");
    expect(pk).toBe("$run#queue_otp");
    expect(sk).toBe("$meshwelcomepending_1#nodeid_!433d1cec");
  });
});
