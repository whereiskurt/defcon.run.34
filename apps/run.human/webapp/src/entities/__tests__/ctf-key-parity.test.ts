import { describe, it, expect } from "vitest";

import { CtfSolve, CtfScoreEvent, CtfPending, CtfAttempt } from "@/entities/ctf";

/**
 * Key-parity lock for the Phase-44 CTF judge entities (CTF-01 SC-4).
 *
 * Unlike Ctf/Qr, these three entities have NO resolver `.mjs` mirror — the
 * resolver never reads them. But their encoded DynamoDB keys are still a
 * contract downstream phases depend on:
 *   - CtfSolve.sk is the `attribute_not_exists(sk)` idempotency key the
 *     Phase-44-03 judge claims against.
 *   - CtfPending.pk is the park row Phase 46 (covert channel) reads by nonce.
 *   - CtfAttempt is the per-user attempt counter the judge's rate-limit reads.
 *
 * These assertions encode offline via `.params({table})` (no network I/O) and
 * pin the EXACT emitted strings, so any accidental key drift fails loudly here.
 */
const table = "run-human-electro";

describe("CtfSolve key parity", () => {
  it("encodes the primary (challenge, user) idempotency Key", () => {
    const key = CtfSolve.get({ challenge: "sao", user: "user-123" }).params({
      table,
    }).Key;
    expect(key).toEqual({
      pk: "$run#challenge_sao",
      sk: "$ctfsolve_1#user_user-123",
    });
  });

  it("encodes the gsi1 'all my solves' query", () => {
    const params = CtfSolve.query.byUser({ user: "user-123" }).params({ table });
    expect(params.IndexName).toBe("gsi1pk-gsi1sk-index");
    expect(params.ExpressionAttributeValues[":pk"]).toBe("$run#user_user-123");
  });
});

describe("CtfScoreEvent key parity", () => {
  it("encodes the primary (challenge, user, bucket) once-per-window Key", () => {
    const key = CtfScoreEvent.get({
      challenge: "sao",
      user: "user-123",
      bucket: "b-42",
    }).params({ table }).Key;
    // sk carries user#bucket so the once-per-window claim is a conditional put:
    // two solves in the same bucket collide on attribute_not_exists(sk).
    expect(key).toEqual({
      pk: "$run#challenge_sao",
      sk: "$ctfscoreevent_1#user_user-123#bucket_b-42",
    });
  });

  it("encodes the byUser 'all my scoring events' query", () => {
    const params = CtfScoreEvent.query
      .byUser({ user: "user-123" })
      .params({ table });
    expect(params.IndexName).toBe("gsi1pk-gsi1sk-index");
    expect(params.ExpressionAttributeValues[":pk"]).toBe("$run#user_user-123");
  });
});

describe("CtfPending key parity", () => {
  it("encodes the park-and-claim Key by nonce", () => {
    const key = CtfPending.get({ nonce: "n-abc" }).params({ table }).Key;
    expect(key).toEqual({ pk: "$run#nonce_n-abc", sk: "$ctfpending_1" });
  });
});

describe("CtfAttempt key parity", () => {
  it("encodes the per-(challenge, user) attempt-counter Key", () => {
    const key = CtfAttempt.get({ challenge: "sao", user: "user-123" }).params({
      table,
    }).Key;
    expect(key).toEqual({
      pk: "$run#challenge_sao",
      sk: "$ctfattempt_1#user_user-123",
    });
  });
});
