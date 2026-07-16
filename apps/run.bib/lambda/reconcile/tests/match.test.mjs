import { describe, it, expect } from "vitest";

/**
 * Plan 22-04-02 tests: reconciliation matching + BibReconcile ledger IO.
 *
 * All entity IO is dependency-injected via `deps` on `reconcile()` — no
 * DynamoDB required. Covers:
 *   - runnerCode primary match (BIB-XXXX regex found → GSI lookup hits)
 *   - sender name fallback (no runnerCode; sender_display_name → single
 *     unique nameOnBib candidate)
 *   - no match (runnerCode absent; fallback ambiguous)
 *   - idempotence: second call with same receiptId returns
 *     alreadyProcessed=true and DOES NOT re-mutate Bib
 *   - provider=unknown short-circuits (no ledger write, no matcher)
 *   - matcher returns "unmatched" on runnerCode present but GSI miss
 */

import {
  extractRunnerCode,
  normalizeName,
  fuzzyMatchByName,
  reconcileExtractedPayment,
} from "../lib/matcher.mjs";
import { reconcile } from "../lib/reconcile.mjs";
import {
  receiptIdFromMessageId,
  receiptIdFromS3Object,
  deriveReceiptId,
} from "../lib/receipt-id.mjs";

// ---------------------------------------------------------------------------
// Pure matcher helpers
// ---------------------------------------------------------------------------

describe("extractRunnerCode()", () => {
  it("finds BIB-XXXX in a comment", () => {
    expect(extractRunnerCode("Sponsoring my friend for BIB-K7QM at DEF CON!"))
      .toBe("BIB-K7QM");
  });

  it("finds BIB-XXXX at the start of the comment", () => {
    expect(extractRunnerCode("BIB-J3XN good luck!")).toBe("BIB-J3XN");
  });

  it("returns null when no code present", () => {
    expect(extractRunnerCode("just a random note, no bib here")).toBeNull();
  });

  // Payers type the code into a free-text Venmo/CashApp note in whatever case
  // they like. The stored runnerCode (and the byRunnerCode GSI key) is always
  // uppercase, so the matcher must accept any case and normalize to uppercase.
  it("matches a lowercase code and normalizes to uppercase", () => {
    // Real prod miss: Benjamin Eason's $200 note was literally "bib-frcb".
    expect(extractRunnerCode("bib-frcb")).toBe("BIB-FRCB");
  });

  it("matches a mixed-case code and normalizes to uppercase", () => {
    expect(extractRunnerCode("Thanks! Bib-K7qm")).toBe("BIB-K7QM");
  });

  it("returns null when code uses ambiguous chars (O/I/0/1)", () => {
    expect(extractRunnerCode("BIB-K0QM (typo!)")).toBeNull();
    expect(extractRunnerCode("BIB-K1QM")).toBeNull();
    expect(extractRunnerCode("BIB-OQIL")).toBeNull();
  });

  it("returns null on empty or non-string input", () => {
    expect(extractRunnerCode("")).toBeNull();
    expect(extractRunnerCode(null)).toBeNull();
    expect(extractRunnerCode(undefined)).toBeNull();
  });
});

describe("normalizeName()", () => {
  it("lowercases + strips whitespace/punctuation", () => {
    expect(normalizeName("Alice Johnson!")).toBe("alicejohnson");
    expect(normalizeName("  Bob   Rivera  ")).toBe("bobrivera");
    expect(normalizeName("O'Malley-Jones")).toBe("omalleyjones");
  });

  it("returns empty string on falsy input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("fuzzyMatchByName()", () => {
  const bibs = [
    { ownerSub: "sub-1", nameOnBib: "Alice Johnson", runnerCode: "BIB-K7QM" },
    { ownerSub: "sub-2", nameOnBib: "Bob Rivera", runnerCode: "BIB-J3XN" },
    { ownerSub: "sub-3", nameOnBib: "Charlie", runnerCode: "BIB-XYZ4" },
    { ownerSub: "sub-4", nameOnBib: "", runnerCode: "BIB-BLANK" },
  ];

  it("matches by contains: sender_display_name = nameOnBib", () => {
    expect(fuzzyMatchByName("Alice Johnson", bibs)).toEqual([bibs[0]]);
  });

  it("matches sender_display_name that expands the nameOnBib (Charlie → Charlie Brown)", () => {
    expect(fuzzyMatchByName("Charlie Brown", bibs)).toEqual([bibs[2]]);
  });

  it("matches nameOnBib that expands the sender name", () => {
    expect(fuzzyMatchByName("Alice", bibs)).toEqual([bibs[0]]);
  });

  it("returns empty on <3 char normalized sender name", () => {
    expect(fuzzyMatchByName("Al", bibs)).toEqual([]);
    expect(fuzzyMatchByName("", bibs)).toEqual([]);
  });

  it("skips bibs with empty/tiny nameOnBib", () => {
    const matches = fuzzyMatchByName("BLANK", bibs);
    expect(matches.every((b) => b.nameOnBib !== "")).toBe(true);
  });

  it("can return multiple candidates (ambiguous)", () => {
    const twoAlices = [
      { ownerSub: "sub-a", nameOnBib: "Alice Johnson", runnerCode: "BIB-A" },
      { ownerSub: "sub-b", nameOnBib: "Alice Smith", runnerCode: "BIB-B" },
    ];
    expect(fuzzyMatchByName("Alice", twoAlices).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// reconcileExtractedPayment
// ---------------------------------------------------------------------------

describe("reconcileExtractedPayment()", () => {
  const targetBib = {
    ownerSub: "sub-K7QM",
    nameOnBib: "Alice Johnson",
    runnerCode: "BIB-K7QM",
  };

  it("primary match on BIB-XXXX → confidence=high, strategy=runner_code", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice Johnson",
        comment_text: "For BIB-K7QM — thanks!",
        confidence: "high",
      },
      getBibByRunnerCode: async (code) =>
        code === "BIB-K7QM" ? targetBib : null,
    });
    expect(result.status).toBe("matched");
    expect(result.matchedOwnerSub).toBe("sub-K7QM");
    expect(result.matchStrategy).toBe("runner_code");
    expect(result.confidence).toBe("high");
  });

  it("lowercase code in note → primary runner_code match (GSI keyed uppercase)", async () => {
    // Regression for the real prod miss: note "bib-frcb" must resolve to the
    // uppercase GSI key BIB-FRCB and match via the primary strategy, NOT fall
    // through to the (failing) name fallback.
    let lookedUpWith = null;
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 20000,
        sender_display_name: "Benjamin Eason",
        comment_text: "bib-frcb",
        confidence: "high",
      },
      getBibByRunnerCode: async (code) => {
        lookedUpWith = code;
        return code === "BIB-K7QM" ? targetBib : null;
      },
    });
    expect(lookedUpWith).toBe("BIB-FRCB"); // note "bib-frcb" uppercased for GSI
    // No bib with that code here, so it correctly falls through to unmatched;
    // the point is the lookup key was normalized. A resolving match is below.
    expect(result.status).toBe("unmatched");
  });

  it("lowercase code that resolves → matched via runner_code", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 20000,
        sender_display_name: "Benjamin Eason",
        comment_text: "bib-k7qm",
        confidence: "high",
      },
      getBibByRunnerCode: async (code) =>
        code === "BIB-K7QM" ? targetBib : null,
    });
    expect(result.status).toBe("matched");
    expect(result.matchedOwnerSub).toBe("sub-K7QM");
    expect(result.matchStrategy).toBe("runner_code");
  });

  it("fallback match on sender name → confidence=medium, strategy=name_fallback", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice Johnson",
        comment_text: "no bib code here",
        confidence: "medium",
      },
      getBibByRunnerCode: async () => null,
      listAllBibs: async () => [targetBib],
    });
    expect(result.status).toBe("matched");
    expect(result.matchedOwnerSub).toBe("sub-K7QM");
    expect(result.matchStrategy).toBe("name_fallback");
    expect(result.confidence).toBe("medium");
  });

  it("ambiguous fallback (2 candidates) → status=unmatched, no ownerSub", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice",
        comment_text: "no bib code",
        confidence: "low",
      },
      getBibByRunnerCode: async () => null,
      listAllBibs: async () => [
        { ownerSub: "sub-a", nameOnBib: "Alice Johnson", runnerCode: "BIB-A" },
        { ownerSub: "sub-b", nameOnBib: "Alice Smith", runnerCode: "BIB-B" },
      ],
    });
    expect(result.status).toBe("unmatched");
    expect(result.matchedOwnerSub).toBeUndefined();
    expect(result.matchStrategy).toBe("none");
  });

  it("no runnerCode + no fallback fn → status=unmatched", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice Johnson",
        comment_text: "no code",
        confidence: "low",
      },
      getBibByRunnerCode: async () => null,
    });
    expect(result.status).toBe("unmatched");
    expect(result.matchStrategy).toBe("none");
  });

  it("runnerCode present but GSI miss → falls back to name search", async () => {
    const result = await reconcileExtractedPayment({
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        sender_display_name: "Alice Johnson",
        comment_text: "BIB-K7QM but that bib was deleted",
        confidence: "medium",
      },
      getBibByRunnerCode: async () => null,
      listAllBibs: async () => [targetBib],
    });
    expect(result.status).toBe("matched");
    expect(result.matchStrategy).toBe("name_fallback");
  });
});

// ---------------------------------------------------------------------------
// receipt-id
// ---------------------------------------------------------------------------

describe("receipt-id helpers", () => {
  it("receiptIdFromMessageId strips angle brackets and hashes deterministically", () => {
    const a = receiptIdFromMessageId("<abc@venmo.com>");
    const b = receiptIdFromMessageId("abc@venmo.com");
    expect(a).toBe(b);
    expect(a?.startsWith("mid_")).toBe(true);
    expect(a?.length).toBe("mid_".length + 64);
  });

  it("receiptIdFromMessageId returns null on blank input", () => {
    expect(receiptIdFromMessageId(null)).toBeNull();
    expect(receiptIdFromMessageId("")).toBeNull();
    expect(receiptIdFromMessageId("   ")).toBeNull();
  });

  it("receiptIdFromS3Object hashes bucket+key together", () => {
    const a = receiptIdFromS3Object("b1", "k1");
    const b = receiptIdFromS3Object("b1", "k2");
    expect(a).not.toBe(b);
    expect(a.startsWith("s3_")).toBe(true);
  });

  it("deriveReceiptId prefers Message-ID, falls back to S3", () => {
    expect(
      deriveReceiptId({ messageId: "<abc@venmo.com>", bucket: "b", key: "k" })
    ).toBe(receiptIdFromMessageId("<abc@venmo.com>"));
    expect(
      deriveReceiptId({ messageId: null, bucket: "b", key: "k" })
    ).toBe(receiptIdFromS3Object("b", "k"));
  });
});

// ---------------------------------------------------------------------------
// reconcile() orchestrator
// ---------------------------------------------------------------------------

function makeMockDeps({
  bibsByRunnerCode = {},
  allBibs = [],
  existingLedgerIds = new Set(),
} = {}) {
  const applied = [];
  const statusUpdates = [];
  const created = [];

  return {
    applied,
    statusUpdates,
    created,
    deps: {
      createLedgerEntry: async (input) => {
        if (existingLedgerIds.has(input.receiptId)) {
          return {
            alreadyExists: true,
            item: { receiptId: input.receiptId, status: "matched" },
          };
        }
        created.push(input);
        existingLedgerIds.add(input.receiptId);
        return { alreadyExists: false, item: { ...input, status: "unmatched" } };
      },
      getBibByRunnerCode: async (runnerCode) =>
        bibsByRunnerCode[runnerCode] ?? null,
      listAllBibs: async () => allBibs,
      applyPaymentToBib: async (input) => {
        applied.push(input);
        return {
          ownerSub: input.ownerSub,
          paidAmount: input.amount_cents,
          paidStatusHistory: [
            {
              provider: input.provider,
              amount: input.amount_cents,
              timestamp: input.timestamp,
              reconciled_via: input.reconciled_via,
            },
          ],
        };
      },
      updateReconcileStatus: async (receiptId, patch) => {
        statusUpdates.push({ receiptId, ...patch });
        return { receiptId, ...patch };
      },
    },
  };
}

describe("reconcile() orchestrator", () => {
  it("runnerCode primary → creates ledger, applies payment, updates status=matched", async () => {
    const mock = makeMockDeps({
      bibsByRunnerCode: {
        "BIB-K7QM": {
          ownerSub: "sub-K7QM",
          nameOnBib: "Alice Johnson",
          runnerCode: "BIB-K7QM",
        },
      },
    });

    const result = await reconcile({
      receiptId: "mid_test1",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        currency: "usd",
        sender_display_name: "Alice Johnson",
        comment_text: "For BIB-K7QM — thanks!",
        confidence: "high",
      },
      deps: mock.deps,
    });

    expect(result.status).toBe("matched");
    expect(result.matchedOwnerSub).toBe("sub-K7QM");
    expect(result.matchStrategy).toBe("runner_code");
    expect(result.alreadyProcessed).toBe(false);

    expect(mock.created).toHaveLength(1);
    expect(mock.created[0]).toMatchObject({
      receiptId: "mid_test1",
      provider: "venmo",
      extractedAmount: 2500,
      extractedComment: "For BIB-K7QM — thanks!",
      extractedSenderName: "Alice Johnson",
    });

    expect(mock.applied).toHaveLength(1);
    expect(mock.applied[0]).toMatchObject({
      ownerSub: "sub-K7QM",
      provider: "venmo",
      amount_cents: 2500,
      reconciled_via: "haiku_reconcile_mid_test1",
    });

    expect(mock.statusUpdates).toHaveLength(1);
    expect(mock.statusUpdates[0]).toMatchObject({
      receiptId: "mid_test1",
      status: "matched",
      matchedOwnerSub: "sub-K7QM",
    });
  });

  it("name fallback → creates ledger, applies payment, updates status=matched", async () => {
    const target = {
      ownerSub: "sub-alice",
      nameOnBib: "Alice Johnson",
      runnerCode: "BIB-K7QM",
    };
    const mock = makeMockDeps({
      bibsByRunnerCode: {},
      allBibs: [target],
    });

    const result = await reconcile({
      receiptId: "mid_fallback1",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "cashapp",
        amount_cents: 5000,
        currency: "usd",
        sender_display_name: "Alice Johnson",
        comment_text: "no bib code — sender identifies by name",
        confidence: "medium",
      },
      deps: mock.deps,
    });

    expect(result.status).toBe("matched");
    expect(result.matchStrategy).toBe("name_fallback");
    expect(mock.applied[0].ownerSub).toBe("sub-alice");
  });

  it("no match → creates ledger, DOES NOT apply payment, updates status=unmatched", async () => {
    const mock = makeMockDeps({
      bibsByRunnerCode: {},
      allBibs: [
        { ownerSub: "sub-a", nameOnBib: "Alice A", runnerCode: "BIB-A" },
        { ownerSub: "sub-b", nameOnBib: "Alice B", runnerCode: "BIB-B" },
      ],
    });

    const result = await reconcile({
      receiptId: "mid_nomatch1",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "venmo",
        amount_cents: 1000,
        currency: "usd",
        sender_display_name: "Alice",
        comment_text: "just a hi",
        confidence: "low",
      },
      deps: mock.deps,
    });

    expect(result.status).toBe("unmatched");
    expect(mock.applied).toHaveLength(0);
    expect(mock.statusUpdates).toHaveLength(1);
    expect(mock.statusUpdates[0].status).toBe("unmatched");
  });

  it("idempotent: second call with same receiptId returns alreadyProcessed=true and skips mutations", async () => {
    const existing = new Set(["mid_dupe"]);
    const mock = makeMockDeps({
      existingLedgerIds: existing,
      bibsByRunnerCode: {
        "BIB-K7QM": {
          ownerSub: "sub-K7QM",
          runnerCode: "BIB-K7QM",
          nameOnBib: "Alice",
        },
      },
    });

    const result = await reconcile({
      receiptId: "mid_dupe",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "venmo",
        amount_cents: 2500,
        currency: "usd",
        sender_display_name: "Alice",
        comment_text: "BIB-K7QM",
        confidence: "high",
      },
      deps: mock.deps,
    });

    expect(result.alreadyProcessed).toBe(true);
    expect(mock.applied).toHaveLength(0);
    expect(mock.statusUpdates).toHaveLength(0);
  });

  it("provider=unknown short-circuits BEFORE any ledger write", async () => {
    const mock = makeMockDeps();
    const result = await reconcile({
      receiptId: "mid_junk",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "unknown",
        amount_cents: 0,
        currency: "usd",
        sender_display_name: "",
        comment_text: "",
        confidence: "low",
      },
      deps: mock.deps,
    });

    expect(result.status).toBe("unmatched");
    expect(mock.created).toHaveLength(0);
    expect(mock.applied).toHaveLength(0);
    expect(mock.statusUpdates).toHaveLength(0);
  });

  it("matched but amount_cents=0 → ledger created, but no applyPayment", async () => {
    const mock = makeMockDeps({
      bibsByRunnerCode: {
        "BIB-K7QM": {
          ownerSub: "sub-K7QM",
          runnerCode: "BIB-K7QM",
          nameOnBib: "Alice",
        },
      },
    });

    const result = await reconcile({
      receiptId: "mid_zero",
      receivedAtMs: 1783000000000,
      extracted: {
        provider: "venmo",
        amount_cents: 0,
        currency: "usd",
        sender_display_name: "Alice",
        comment_text: "For BIB-K7QM",
        confidence: "low",
      },
      deps: mock.deps,
    });

    expect(mock.applied).toHaveLength(0);
    expect(mock.created).toHaveLength(1);
    expect(result.status).toBe("unmatched");
  });
});
