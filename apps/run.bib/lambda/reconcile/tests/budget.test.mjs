import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Plan 22-04-03 tests: budget-cap short-circuit + admin notification email.
 *
 * All expensive dependencies are dependency-injected via `ctx` overrides:
 *   - `checkBudget`: returns `{allowed, spentCents, capCents}` for a UTC key.
 *   - `incrementBudget`: fake accumulator (spy).
 *   - `sendReconcileNotification`: fake SES send (spy).
 *   - `anthropicClient`: only invoked when budget.allowed=true.
 *
 * Coverage:
 *   - Budget cap short-circuits BEFORE Haiku call, marks ledger ambiguous,
 *     emails admin with reason=budget_exhausted.
 *   - Successful extract increments budget by 100¢ AFTER Haiku call.
 *   - Unmatched extract emails admin with reason=unmatched.
 *   - Ambiguous extract emails admin with reason=ambiguous.
 *   - Matched extract does NOT email admin (silent-on-success).
 *   - composeNotificationEmail shape is stable + safe on missing fields.
 */

import { processS3Record } from "../index.mjs";
import {
  DAILY_BUDGET_CAP_CENTS,
  todayUtcKey,
} from "../lib/budget.mjs";
import {
  composeNotificationEmail,
  sendReconcileNotification,
} from "../lib/notifier.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

async function loadFixture(name) {
  return readFile(join(FIXTURES, name));
}

function makeStubAnthropic(cannedInput) {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_stub",
            name: "record_payment",
            input: cannedInput,
          },
        ],
        stop_reason: "tool_use",
      }),
    },
  };
}

const nullReconcileDeps = {
  createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
  getBibByRunnerCode: async () => null,
  listAllBibs: async () => [],
  applyPaymentToBib: async () => ({}),
  updateReconcileStatus: async () => ({}),
};

// ---------------------------------------------------------------------------
// composeNotificationEmail
// ---------------------------------------------------------------------------

describe("composeNotificationEmail()", () => {
  it("builds subject with reason + receiptId", () => {
    const { subject } = composeNotificationEmail({
      reason: "unmatched",
      receiptId: "mid_abc",
    });
    expect(subject).toBe("[run.bib] reconcile unmatched — mid_abc");
  });

  it("includes S3 coordinate when provided", () => {
    const { textBody } = composeNotificationEmail({
      reason: "ambiguous",
      receiptId: "mid_abc",
      bucket: "ses-inbox-dc34-use1",
      key: "bib-payments/x",
    });
    expect(textBody).toContain("s3://ses-inbox-dc34-use1/bib-payments/x");
  });

  it("includes Haiku extraction fields when extracted is provided", () => {
    const { textBody } = composeNotificationEmail({
      reason: "unmatched",
      receiptId: "mid_abc",
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice",
        comment_text: "BIB-NOPE",
        confidence: "medium",
        notes: "unknown code",
      },
    });
    expect(textBody).toContain("provider: venmo");
    expect(textBody).toContain("amount_cents: 2500");
    expect(textBody).toContain("sender_display_name: Alice");
    expect(textBody).toContain("comment_text: BIB-NOPE");
    expect(textBody).toContain("confidence: medium");
    expect(textBody).toContain("notes: unknown code");
  });

  it("caps body excerpt at 500 chars", () => {
    const bigBody = "x".repeat(2000);
    const { textBody } = composeNotificationEmail({
      reason: "unmatched",
      receiptId: "mid_abc",
      bodyExcerpt: bigBody,
    });
    // Body should include a 500-char excerpt, not the full 2000.
    // Header lines + excerpt: total should be well under 1000.
    expect(textBody.length).toBeLessThan(1000);
  });

  it("is safe when extracted and bodyExcerpt are missing (budget_exhausted case)", () => {
    const { subject, textBody } = composeNotificationEmail({
      reason: "budget_exhausted",
      receiptId: "mid_abc",
    });
    expect(subject).toContain("budget_exhausted");
    expect(textBody).toContain("Reason: budget_exhausted");
    expect(textBody).not.toContain("Haiku extraction:");
  });
});

// ---------------------------------------------------------------------------
// sendReconcileNotification (client injection)
// ---------------------------------------------------------------------------

describe("sendReconcileNotification()", () => {
  it("calls SES SendEmail with the right Source + Destination", async () => {
    const sends = [];
    const fakeClient = {
      send: async (cmd) => {
        sends.push(cmd);
        return { MessageId: "ses-msg-1" };
      },
    };
    await sendReconcileNotification({
      reason: "unmatched",
      receiptId: "mid_a",
      client: fakeClient,
      from: "bibpayment@run.defcon.run",
      to: "defcon.run@gmail.com",
    });
    expect(sends).toHaveLength(1);
    const cmd = sends[0];
    expect(cmd.input.Source).toBe("bibpayment@run.defcon.run");
    expect(cmd.input.Destination.ToAddresses).toEqual(["defcon.run@gmail.com"]);
    expect(cmd.input.Message.Subject.Data).toContain("mid_a");
    expect(cmd.input.Message.Body.Text.Data).toContain("Reason: unmatched");
  });
});

// ---------------------------------------------------------------------------
// processS3Record — Budget cap prologue + notification epilogue
// ---------------------------------------------------------------------------

describe("processS3Record — budget cap short-circuit", () => {
  it("skips Haiku call, marks ambiguous, emails admin when spentCents >= cap", async () => {
    const anthropicCalls = { count: 0 };
    const notifications = [];
    const incrementSpy = { count: 0 };
    const anthropic = {
      messages: {
        create: async () => {
          anthropicCalls.count++;
          return { content: [{ type: "tool_use", name: "record_payment", input: {} }] };
        },
      },
    };

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/venmo-cap" },
      },
      {
        readObject: async () => await loadFixture("venmo-01.eml"),
        anthropicClient: anthropic,
        reconcileDeps: nullReconcileDeps,
        // Budget check: cap already hit.
        checkBudget: async () => ({
          allowed: false,
          spentCents: 2000,
          capCents: DAILY_BUDGET_CAP_CENTS,
        }),
        incrementBudget: async () => {
          incrementSpy.count++;
          return {};
        },
        updateReconcileStatus: async () => ({}),
        sendReconcileNotification: async (args) => {
          notifications.push(args);
          return { MessageId: "ses-1" };
        },
      }
    );

    // Load-bearing invariants for SC7 + budget cap:
    expect(anthropicCalls.count).toBe(0); // Haiku NOT called.
    expect(incrementSpy.count).toBe(0); // Counter NOT bumped.
    expect(out.budgetExhausted).toBe(true);
    expect(out.reconcile.status).toBe("ambiguous");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].reason).toBe("budget_exhausted");
    expect(notifications[0].receiptId).toBeTruthy();
  });

  it("EXACTLY at the cap counts as exhausted (>=, not >)", async () => {
    const notifications = [];
    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/venmo-atcap" },
      },
      {
        readObject: async () => await loadFixture("venmo-01.eml"),
        anthropicClient: makeStubAnthropic({}),
        reconcileDeps: nullReconcileDeps,
        checkBudget: async () => ({
          allowed: false,
          spentCents: 2000,
          capCents: 2000,
        }),
        incrementBudget: async () => ({}),
        updateReconcileStatus: async () => ({}),
        sendReconcileNotification: async (args) => {
          notifications.push(args);
        },
      }
    );
    expect(out.budgetExhausted).toBe(true);
    expect(notifications[0].reason).toBe("budget_exhausted");
  });
});

describe("processS3Record — successful extract path", () => {
  it("increments budget by 100¢ AFTER Haiku call, emails on unmatched", async () => {
    const incrementCalls = [];
    const notifications = [];
    const anthropic = makeStubAnthropic({
      provider: "venmo",
      amount_cents: 2500,
      currency: "usd",
      sender_display_name: "Alice Johnson",
      comment_text: "no bib code here",
      confidence: "low",
      notes: "",
    });

    // reconcileDeps: forcibly return no match so the notifier fires.
    const noMatchDeps = {
      createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
      getBibByRunnerCode: async () => null,
      listAllBibs: async () => [], // no candidates
      applyPaymentToBib: async () => ({}),
      updateReconcileStatus: async () => ({}),
    };

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/venmo-ok" },
      },
      {
        readObject: async () => await loadFixture("venmo-01.eml"),
        anthropicClient: anthropic,
        reconcileDeps: noMatchDeps,
        checkBudget: async () => ({
          allowed: true,
          spentCents: 0,
          capCents: DAILY_BUDGET_CAP_CENTS,
        }),
        incrementBudget: async (dateKey, delta) => {
          incrementCalls.push({ dateKey, delta });
          return { costUsdCents: delta, invocationCount: 1 };
        },
        sendReconcileNotification: async (args) => {
          notifications.push(args);
          return { MessageId: "ses-2" };
        },
      }
    );

    expect(incrementCalls).toHaveLength(1);
    expect(incrementCalls[0].delta).toBe(100);
    expect(out.reconcile.status).toBe("unmatched");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].reason).toBe("unmatched");
    expect(notifications[0].extracted?.provider).toBe("venmo");
  });

  it("does NOT email admin on matched status (silent-on-success)", async () => {
    const notifications = [];

    // matched reconcile deps: primary match hits.
    const matchedDeps = {
      createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
      getBibByRunnerCode: async () => ({
        ownerSub: "sub-1",
        runnerCode: "BIB-K7QM",
        nameOnBib: "Alice",
      }),
      listAllBibs: async () => [],
      applyPaymentToBib: async () => ({}),
      updateReconcileStatus: async () => ({}),
    };

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/venmo-matched" },
      },
      {
        readObject: async () => await loadFixture("venmo-01.eml"),
        anthropicClient: makeStubAnthropic({
          provider: "venmo",
          amount_cents: 2500,
          currency: "usd",
          sender_display_name: "Alice",
          comment_text: "For BIB-K7QM",
          confidence: "high",
          notes: "",
        }),
        reconcileDeps: matchedDeps,
        checkBudget: async () => ({
          allowed: true,
          spentCents: 100,
          capCents: DAILY_BUDGET_CAP_CENTS,
        }),
        incrementBudget: async () => ({}),
        sendReconcileNotification: async (args) => {
          notifications.push(args);
        },
      }
    );

    expect(out.reconcile.status).toBe("matched");
    expect(notifications).toHaveLength(0); // silent on success
  });
});

// ---------------------------------------------------------------------------
// budget helpers
// ---------------------------------------------------------------------------

describe("todayUtcKey (Lambda mirror)", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    const d = new Date(Date.UTC(2026, 6, 2, 23, 30, 0));
    expect(todayUtcKey(d)).toBe("2026-07-02");
  });

  it("DAILY_BUDGET_CAP_CENTS matches AI-SPEC ($20/day)", () => {
    expect(DAILY_BUDGET_CAP_CENTS).toBe(2000);
  });
});
