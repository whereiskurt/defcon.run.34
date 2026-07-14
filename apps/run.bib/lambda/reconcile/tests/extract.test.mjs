import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Plan 22-04-01 tests: Haiku extractor + processS3Record wiring.
 *
 * All Anthropic SDK calls are mocked via a stub `client` injected into
 * `extractPaymentFromEmail` and via `ctx.anthropicClient` on
 * `processS3Record`. The tests DO exercise:
 *   - `parseReceiptEmail` against three real MIME fixtures (venmo, cashapp,
 *     junk) — no mocking there.
 *   - The prompt shape sent to Anthropic (system + user + tool_choice).
 *   - The extract shape (normalization of tool_use.input).
 *
 * Live-API sanity check: gated behind `INTEGRATION=1` env var so CI stays
 * free of Anthropic spend. When present, one fixture round-trips against
 * the real Haiku 4.5 endpoint.
 *
 * Uses top-level `.mjs` imports (no vi.mock on @anthropic-ai/sdk); the
 * dependency-injection surface on `extractPaymentFromEmail({client})` and
 * `processS3Record(_, {anthropicClient})` avoids the ESM-mock complexity.
 */

import { parseReceiptEmail, BODY_TRIM_CHARS } from "../lib/parse-email.mjs";
import { extractPaymentFromEmail } from "../lib/haiku.mjs";
import { processS3Record } from "../index.mjs";
import { HAIKU_MODEL_ID, RECORD_PAYMENT_TOOL, SYSTEM_PROMPT } from "../prompt.js";

// The processS3Record tests below drive the pipeline with raw provider-From
// fixtures (Venmo/CashApp/junk). Satisfy the sender-allowlist gate so they
// reach the extraction logic under test. The gate itself is covered in
// allowlist.test.mjs.
process.env.BIB_ALLOWED_SENDERS =
  "venmo@venmo.com,cash@square.com,newsletter@example-marketing.com";
// DMARC enforcement is exercised in dmarc-gate.test.mjs; disable it here so the
// fixture emails (no SES Authentication-Results header) reach the logic under test.
process.env.BIB_ENFORCE_DMARC = "false";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

/**
 * Build a fake Anthropic client that returns a canned tool_use response and
 * records the create-args for assertions.
 */
function makeStubClient(cannedInput) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        return {
          id: "msg_stub_1",
          type: "message",
          role: "assistant",
          model: HAIKU_MODEL_ID,
          content: [
            {
              type: "tool_use",
              id: "toolu_stub_1",
              name: "record_payment",
              input: cannedInput,
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 500, output_tokens: 100 },
        };
      },
    },
  };
}

async function loadFixture(name) {
  return readFile(join(FIXTURES, name));
}

describe("parseReceiptEmail (fixture round-trips)", () => {
  it("parses the Venmo fixture and pulls Message-ID + From + subject", async () => {
    const raw = await loadFixture("venmo-01.eml");
    const p = await parseReceiptEmail(raw);
    expect(p.messageId).toBeTruthy();
    expect(p.messageId).toContain("venmo.com");
    expect(p.from?.address).toBe("venmo@venmo.com");
    expect(p.subject).toContain("$25.00");
    expect(p.bodyText).toContain("BIB-K7QM");
    // Trim guard — the fixture is well under 10k but the cap should apply.
    expect(p.bodyText.length).toBeLessThanOrEqual(BODY_TRIM_CHARS);
  });

  it("parses the CashApp fixture", async () => {
    const raw = await loadFixture("cashapp-01.eml");
    const p = await parseReceiptEmail(raw);
    expect(p.from?.address).toBe("cash@square.com");
    expect(p.bodyText).toContain("For: BIB-J3XN");
    expect(p.subject).toContain("$50.00");
  });

  it("parses the junk fixture (no BIB-XXXX in body)", async () => {
    const raw = await loadFixture("junk-01.eml");
    const p = await parseReceiptEmail(raw);
    expect(p.from?.address).toBe("newsletter@example-marketing.com");
    expect(p.bodyText).not.toMatch(/BIB-[A-HJ-NP-Z2-9]{4}/);
  });
});

describe("extractPaymentFromEmail (stub Anthropic client)", () => {
  it("sends the pinned model, forced tool_choice, and full system prompt", async () => {
    const client = makeStubClient({
      provider: "venmo",
      amount_cents: 2500,
      currency: "usd",
      sender_display_name: "Alice Johnson",
      comment_text: "Sponsoring my friend for BIB-K7QM at DEF CON Run 34!",
      confidence: "high",
      notes: "",
    });

    const out = await extractPaymentFromEmail({
      bodyText: "irrelevant body — stub client canned response",
      subject: "Alice Johnson paid you $25.00",
      client,
    });

    // Prompt shape assertions.
    expect(client.calls).toHaveLength(1);
    const args = client.calls[0];
    expect(args.model).toBe(HAIKU_MODEL_ID);
    expect(args.system).toBe(SYSTEM_PROMPT);
    expect(args.tools).toEqual([RECORD_PAYMENT_TOOL]);
    expect(args.tool_choice).toEqual({
      type: "tool",
      name: "record_payment",
    });
    expect(args.max_tokens).toBe(1024);
    // Subject is prefixed onto the user message so Haiku sees the "provider hint".
    expect(args.messages[0].role).toBe("user");
    expect(args.messages[0].content).toContain("Subject: Alice Johnson paid you $25.00");

    // Extract shape assertions.
    expect(out.provider).toBe("venmo");
    expect(out.amount_cents).toBe(2500);
    expect(out.sender_display_name).toBe("Alice Johnson");
    expect(out.comment_text).toContain("BIB-K7QM");
    expect(out.confidence).toBe("high");
    expect(out._raw).toBeTypeOf("object");
  });

  it("normalizes a partial tool_use response defensively", async () => {
    // Anthropic sometimes returns extra_notes fields or omits `notes` — the
    // extractor guards against a missing `notes` + unusual provider string.
    const client = makeStubClient({
      provider: "paypal", // not in schema enum; extractor coerces to "unknown"
      amount_cents: "40", // not an integer; extractor coerces to 0
      currency: "usd",
      sender_display_name: null, // extractor coerces to ""
      comment_text: undefined, // extractor coerces to ""
      confidence: "definitely", // not in enum; extractor coerces to "low"
    });

    const out = await extractPaymentFromEmail({
      bodyText: "junk email — nothing to extract",
      client,
    });

    expect(out.provider).toBe("unknown");
    expect(out.amount_cents).toBe(0);
    expect(out.sender_display_name).toBe("");
    expect(out.comment_text).toBe("");
    expect(out.confidence).toBe("low");
    expect(out.notes).toBe("");
  });

  it("throws when Anthropic returns no tool_use block", async () => {
    const badClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "sorry, could not extract" }],
        }),
      },
    };

    await expect(
      extractPaymentFromEmail({
        bodyText: "receipt body",
        client: badClient,
      })
    ).rejects.toThrow(/no record_payment tool_use/);
  });
});

describe("processS3Record (end-to-end with injected clients)", () => {
  let readObject;
  let seen;
  // Null-reconcile deps: don't touch DDB. Task 22-04-01 tests only exercise
  // parse + Haiku extract; match.test.mjs exercises the reconcile path;
  // budget.test.mjs exercises the budget + notification epilogue.
  const nullReconcileDeps = {
    createLedgerEntry: async () => ({ alreadyExists: false, item: {} }),
    getBibByRunnerCode: async () => null,
    listAllBibs: async () => [],
    applyPaymentToBib: async () => ({}),
    updateReconcileStatus: async () => ({}),
  };
  // Task 22-04-03 wired budget + notifier into processS3Record. The
  // extract-level tests inject no-op stubs so they don't hit DDB/SES.
  const nullBudgetCtx = {
    checkBudget: async () => ({ allowed: true, spentCents: 0, capCents: 2000 }),
    incrementBudget: async () => ({ costUsdCents: 100, invocationCount: 1 }),
    sendReconcileNotification: async () => ({ MessageId: "test-msg" }),
    updateReconcileStatus: async () => ({}),
  };

  beforeEach(() => {
    seen = [];
    readObject = async (bucket, key) => {
      seen.push({ bucket, key });
      return await loadFixture(
        key.includes("venmo") ? "venmo-01.eml" :
        key.includes("cashapp") ? "cashapp-01.eml" :
        "junk-01.eml"
      );
    };
  });

  it("pipes venmo fixture through parse + Haiku extraction", async () => {
    const anthropic = makeStubClient({
      provider: "venmo",
      amount_cents: 2500,
      currency: "usd",
      sender_display_name: "Alice Johnson",
      comment_text: "Sponsoring my friend for BIB-K7QM at DEF CON Run 34!",
      confidence: "high",
      notes: "",
    });

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/venmo-abc123" },
      },
      { readObject, anthropicClient: anthropic, reconcileDeps: nullReconcileDeps, ...nullBudgetCtx }
    );

    expect(seen).toEqual([
      { bucket: "ses-inbox-dc34-use1", key: "bib-payments/venmo-abc123" },
    ]);
    expect(out.messageId).toContain("venmo.com");
    expect(out.extracted.provider).toBe("venmo");
    expect(out.extracted.amount_cents).toBe(2500);
    expect(out.extracted.comment_text).toContain("BIB-K7QM");
  });

  it("pipes cashapp fixture through parse + Haiku extraction", async () => {
    const anthropic = makeStubClient({
      provider: "cashapp",
      amount_cents: 5000,
      currency: "usd",
      sender_display_name: "Bob Rivera",
      comment_text: "BIB-J3XN good luck at DEF CON!",
      confidence: "high",
      notes: "",
    });

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/cashapp-def456" },
      },
      { readObject, anthropicClient: anthropic, reconcileDeps: nullReconcileDeps, ...nullBudgetCtx }
    );

    expect(out.extracted.provider).toBe("cashapp");
    expect(out.extracted.amount_cents).toBe(5000);
    expect(out.extracted.sender_display_name).toBe("Bob Rivera");
  });

  it("returns provider='unknown' + amount=0 on a junk email", async () => {
    const anthropic = makeStubClient({
      provider: "unknown",
      amount_cents: 0,
      currency: "usd",
      sender_display_name: "",
      comment_text: "",
      confidence: "low",
      notes: "not a payment receipt",
    });

    const out = await processS3Record(
      {
        bucket: { name: "ses-inbox-dc34-use1" },
        object: { key: "bib-payments/junk-ghi789" },
      },
      { readObject, anthropicClient: anthropic, reconcileDeps: nullReconcileDeps, ...nullBudgetCtx }
    );

    expect(out.extracted.provider).toBe("unknown");
    expect(out.extracted.amount_cents).toBe(0);
    expect(out.extracted.confidence).toBe("low");
  });
});

/**
 * Live Haiku round-trip — opt-in via `INTEGRATION=1 vitest run`. Requires a
 * real ANTHROPIC_API_KEY in the environment. Costs ~$0.001/invocation.
 * Kept behind a gate so unattended CI never bills Anthropic.
 */
describe.runIf(process.env.INTEGRATION === "1")("INTEGRATION: live Haiku 4.5", () => {
  it("extracts venmo fixture against the real API", async () => {
    const raw = await loadFixture("venmo-01.eml");
    const parsed = await parseReceiptEmail(raw);
    const out = await extractPaymentFromEmail({
      bodyText: parsed.bodyText,
      subject: parsed.subject ?? undefined,
      // Uses process.env.ANTHROPIC_API_KEY.
    });
    expect(out.provider).toBe("venmo");
    expect(out.amount_cents).toBe(2500);
    expect(out.comment_text).toMatch(/BIB-K7QM/i);
  }, 30000);
});
