import { describe, it, expect } from "vitest";

/**
 * DMARC gate in processS3Record — runs after the allowlist (defense in depth):
 * the From is on the allowlist, but is it really them? Requires SES's
 * dmarc=pass verdict; fail-closed otherwise. Toggleable via ctx.enforceDmarc /
 * env BIB_ENFORCE_DMARC (kill switch).
 */

import { processS3Record } from "../index.mjs";

const ALLOWLIST = "defcon.run@gmail.com,whereiskurt@gmail.com,jesse.krembs@gmail.com";

const nullReconcileDeps = {
  createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
  getBibByRunnerCode: async () => null,
  listAllBibs: async () => [],
  applyPaymentToBib: async () => ({}),
  updateReconcileStatus: async () => ({}),
};

function rawEmail(from, { dmarc } = {}) {
  const lines = [`From: ${from}`, "To: bibpayment@run.defcon.run", "Subject: Fwd: Receipt"];
  if (dmarc) {
    lines.unshift(
      "Authentication-Results: amazonses.com;",
      ` spf=pass client-ip=209.85.128.180;`,
      ` dkim=pass header.i=@gmail.com;`,
      ` dmarc=${dmarc} header.from=gmail.com;`
    );
  }
  lines.push("Message-ID: <dmarc-test@run.defcon.run>", "", "You paid $20.00", "");
  return Buffer.from(lines.join("\r\n"));
}

const rec = { bucket: { name: "ses-inbox-dc34-use1" }, object: { key: "bib-payments/x" } };

describe("processS3Record — DMARC gate", () => {
  it("rejects an allowlisted sender with NO SES verdict (fail-closed) when enforced", async () => {
    let extractorCalled = false;
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      enforceDmarc: true,
      readObject: async () => rawEmail("whereiskurt@gmail.com"), // no A-R header
      anthropicClient: { messages: { create: async () => { extractorCalled = true; return {}; } } },
      checkBudget: async () => { throw new Error("must not check budget"); },
      reconcileDeps: nullReconcileDeps,
    });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("dmarc_fail");
    expect(extractorCalled).toBe(false);
  });

  it("rejects an allowlisted sender whose SES verdict is dmarc=fail", async () => {
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      enforceDmarc: true,
      readObject: async () => rawEmail("whereiskurt@gmail.com", { dmarc: "fail" }),
      reconcileDeps: nullReconcileDeps,
    });
    expect(out.rejected).toBe(true);
    expect(out.rejectReason).toBe("dmarc_fail");
  });

  it("allows an allowlisted sender with SES dmarc=pass to proceed to extraction", async () => {
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      enforceDmarc: true,
      readObject: async () => rawEmail("whereiskurt@gmail.com", { dmarc: "pass" }),
      anthropicClient: {
        messages: {
          create: async () => ({
            content: [{ type: "tool_use", name: "record_payment", input: {
              provider: "venmo", amount_cents: 2000, currency: "USD",
              sender_display_name: "Kurt", comment_text: "", confidence: "high", notes: "",
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

  it("kill switch: enforceDmarc=false skips the check (no verdict still proceeds)", async () => {
    const out = await processS3Record(rec, {
      allowedSenders: ALLOWLIST,
      enforceDmarc: false,
      readObject: async () => rawEmail("whereiskurt@gmail.com"), // no A-R header
      anthropicClient: {
        messages: {
          create: async () => ({
            content: [{ type: "tool_use", name: "record_payment", input: {
              provider: "venmo", amount_cents: 2000, currency: "USD",
              sender_display_name: "Kurt", comment_text: "", confidence: "high", notes: "",
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
  });
});
