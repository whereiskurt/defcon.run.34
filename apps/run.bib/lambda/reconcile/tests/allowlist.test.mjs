import { describe, it, expect } from "vitest";

/**
 * Sender-allowlist security gate.
 *
 * The bib-payment receiver runs a trusted-forwarder model: only an admin
 * (defcon.run@gmail.com / whereiskurt@gmail.com / jesse.krembs@gmail.com)
 * forwards a receipt into bibpayment@run.defcon.run. This gate rejects any
 * inbound whose From address is not on the allowlist BEFORE any Haiku spend,
 * DB write, or bib mutation.
 *
 * Design: log-only silent rejection, fail-closed on empty/missing config.
 */

import { isSenderAllowed } from "../lib/allowlist.mjs";
import { processS3Record } from "../index.mjs";

const nullReconcileDeps = {
  createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
  getBibByRunnerCode: async () => null,
  listAllBibs: async () => [],
  applyPaymentToBib: async () => ({}),
  updateReconcileStatus: async () => ({}),
};

function rawEmail(from, { subject = "Fwd: Receipt", body = "You paid $20.00 — BIB-1234" } = {}) {
  return Buffer.from(
    [
      `From: ${from}`,
      "To: bibpayment@run.defcon.run",
      `Subject: ${subject}`,
      "Message-ID: <allowlist-test@run.defcon.run>",
      "Date: Tue, 14 Jul 2026 12:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      "",
    ].join("\r\n")
  );
}

const ALLOWLIST = "defcon.run@gmail.com,whereiskurt@gmail.com,jesse.krembs@gmail.com";

// ---------------------------------------------------------------------------
// isSenderAllowed — pure matching semantics
// ---------------------------------------------------------------------------

describe("isSenderAllowed()", () => {
  it("accepts an address on the allowlist", () => {
    expect(isSenderAllowed("whereiskurt@gmail.com", ALLOWLIST)).toBe(true);
  });

  it("rejects an address not on the allowlist", () => {
    expect(isSenderAllowed("attacker@evil.com", ALLOWLIST)).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isSenderAllowed("WhereIsKurt@Gmail.Com", ALLOWLIST)).toBe(true);
  });

  it("tolerates surrounding whitespace in address and list entries", () => {
    expect(isSenderAllowed("  jesse.krembs@gmail.com ", " a@b.com , jesse.krembs@gmail.com ")).toBe(true);
  });

  it("fail-closed: empty allowlist rejects everyone", () => {
    expect(isSenderAllowed("whereiskurt@gmail.com", "")).toBe(false);
  });

  it("fail-closed: undefined allowlist rejects everyone", () => {
    expect(isSenderAllowed("whereiskurt@gmail.com", undefined)).toBe(false);
  });

  it("fail-closed: whitespace/comma-only allowlist rejects everyone", () => {
    expect(isSenderAllowed("whereiskurt@gmail.com", " , , ")).toBe(false);
  });

  it("rejects a null or empty From address", () => {
    expect(isSenderAllowed(null, ALLOWLIST)).toBe(false);
    expect(isSenderAllowed("", ALLOWLIST)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processS3Record — allowlist gate integration
// ---------------------------------------------------------------------------

describe("processS3Record — sender allowlist gate", () => {
  const rec = { bucket: { name: "ses-inbox-dc34-use1" }, object: { key: "bib-payments/x" } };

  it("rejects a non-allowlisted sender without spending budget or calling Haiku", async () => {
    let extractorCalled = false;
    let budgetChecked = false;
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      readObject: async () => rawEmail("attacker@evil.com"),
      anthropicClient: { messages: { create: async () => { extractorCalled = true; return {}; } } },
      checkBudget: async () => { budgetChecked = true; return { allowed: true, spentCents: 0, capCents: 2000 }; },
      reconcileDeps: nullReconcileDeps,
    });

    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("unauthorized_sender");
    expect(out.extracted).toBeNull();
    expect(extractorCalled).toBe(false);
    expect(budgetChecked).toBe(false);
  });

  it("allows an allowlisted sender to proceed to extraction", async () => {
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      readObject: async () => rawEmail("whereiskurt@gmail.com"),
      anthropicClient: {
        messages: {
          create: async () => ({
            content: [{ type: "tool_use", name: "record_payment", input: {
              provider: "venmo", amount_cents: 2000, currency: "USD",
              sender_display_name: "Kurt", comment_text: "BIB-1234",
              confidence: "high", notes: "",
            } }],
            stop_reason: "tool_use",
          }),
        },
      },
      checkBudget: async () => ({ allowed: true, spentCents: 0, capCents: 2000 }),
      incrementBudget: async () => ({}),
      reconcileDeps: nullReconcileDeps,
      sendReconcileNotification: async () => ({}),
    });

    expect(out.rejected).toBeFalsy();
    expect(out.extracted).not.toBeNull();
  });

  it("fail-closed: empty allowlist rejects even a would-be admin", async () => {
    const out = await processS3Record(rec, {
      allowedSenders: "",
      readObject: async () => rawEmail("whereiskurt@gmail.com"),
      anthropicClient: { messages: { create: async () => { throw new Error("must not extract"); } } },
      checkBudget: async () => { throw new Error("must not check budget"); },
      reconcileDeps: nullReconcileDeps,
    });

    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("unauthorized_sender");
  });
});
