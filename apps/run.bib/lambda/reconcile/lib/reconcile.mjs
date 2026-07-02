/**
 * Reconciliation orchestrator — glues extractor output to BibReconcile
 * ledger + Bib payment mutation.
 *
 * Kept out of `index.mjs` so:
 *   1. Task 22-04-02's matcher tests can exercise the full write path
 *      against in-memory entity mocks without spinning up S3 + Anthropic.
 *   2. Task 22-04-03 can wrap this with the budget-cap prologue + SES
 *      admin-email epilogue.
 *
 * IDempotence contract:
 *   - `createLedgerEntry` uses `.create()` (implicit PutItem with
 *     attribute_not_exists(pk) — ElectroDB's `.create` semantics). Second
 *     invocation of the same receiptId returns `{alreadyExists: true}`.
 *   - `applyPaymentToBib` uses `.update().add({paidAmount}).append({paidStatusHistory})`
 *     — atomic single UpdateItem. On DDB, ADD is monotonic-safe across
 *     concurrent invocations; APPEND appends to the list.
 */

import { Bib, BibReconcile } from "./entities.mjs";
import { reconcileExtractedPayment } from "./matcher.mjs";

// ---------------------------------------------------------------------------
// Entity IO helpers (thin wrappers so tests can dependency-inject)
// ---------------------------------------------------------------------------

/**
 * Look up a Bib by runnerCode via the byRunnerCode GSI.
 * @param {string} runnerCode
 */
export async function getBibByRunnerCode(runnerCode) {
  const result = await Bib.query.byRunnerCode({ runnerCode }).go();
  return result.data[0] ?? null;
}

/**
 * Scan the Bib entity table (bounded — Phase 22 launch ~200 rows). Used by
 * the matcher's sender-name fallback path.
 *
 * NOTE: ElectroDB `.scan()` streams pages internally when `.go({pages: ...})`
 * is passed. We ask for `'all'` here so the caller gets every row in one
 * awaited array. At launch scale this is cheap; if bib volume ≥ 5k the
 * fallback path should switch to a name-index GSI (out of scope for v1.5).
 */
export async function listAllBibs() {
  const out = [];
  const iter = Bib.scan.go({ pages: "all" });
  // ElectroDB scan().go({pages:"all"}) returns { data: [...] } directly.
  const first = await iter;
  if (Array.isArray(first?.data)) out.push(...first.data);
  return out;
}

/**
 * Create a BibReconcile ledger row idempotently.
 *
 * Returns `{alreadyExists: true, existing}` if the row was already
 * present (Message-ID collision on retry) — caller should NOT re-mutate
 * Bib in that case; the earlier invocation already handled the payment.
 *
 * @param {{
 *   receiptId: string,
 *   receivedAt: number,
 *   provider: "venmo"|"cashapp",
 *   extractedAmount?: number,
 *   extractedComment?: string,
 *   extractedSenderName?: string,
 * }} input
 */
export async function createLedgerEntry(input) {
  try {
    const result = await BibReconcile.create(input).go();
    return { alreadyExists: false, item: result.data };
  } catch (err) {
    const isConditionalFail =
      (err instanceof Error &&
        (err.name === "ConditionalCheckFailedException" ||
          err.message.includes("ConditionalCheckFailed"))) ||
      (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "ConditionalCheckFailedException");

    if (!isConditionalFail) throw err;

    const existing = await BibReconcile.get({
      receiptId: input.receiptId,
    }).go();
    return { alreadyExists: true, item: existing.data };
  }
}

/**
 * Atomically apply a payment to a Bib:
 *   - `paidAmount` incremented by `amount_cents` (ADD, idempotent-safe on retry)
 *   - `paidStatusHistory` appended with a {provider, amount, timestamp,
 *     reconciled_via} entry
 *
 * Single UpdateItem under the hood; safe across concurrent Lambda
 * invocations for the same ownerSub (DDB serializes updates on a PK).
 *
 * @param {{
 *   ownerSub: string,
 *   provider: "venmo"|"cashapp",
 *   amount_cents: number,
 *   reconciled_via: string,
 *   timestamp?: string,
 * }} input
 */
export async function applyPaymentToBib(input) {
  const {
    ownerSub,
    provider,
    amount_cents,
    reconciled_via,
    timestamp = new Date().toISOString(),
  } = input;

  if (!ownerSub) throw new Error("applyPaymentToBib: ownerSub required");
  if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
    throw new Error("applyPaymentToBib: amount_cents must be positive integer");
  }

  const result = await Bib.update({ ownerSub })
    .add({ paidAmount: amount_cents })
    .append({
      paidStatusHistory: [
        { provider, amount: amount_cents, timestamp, reconciled_via },
      ],
    })
    .go({ response: "all_new" });

  return result.data;
}

/**
 * Update a BibReconcile ledger row's status. Used to transition
 * unmatched → matched (with ownerSub) or unmatched → ambiguous (with
 * notes on why).
 *
 * @param {string} receiptId
 * @param {{
 *   status: "matched"|"unmatched"|"ambiguous",
 *   matchedOwnerSub?: string,
 *   notes?: string,
 * }} patch
 */
export async function updateReconcileStatus(receiptId, patch) {
  const setOps = { status: patch.status };
  if (patch.matchedOwnerSub) setOps.matchedOwnerSub = patch.matchedOwnerSub;
  if (typeof patch.notes === "string") setOps.notes = patch.notes;

  const result = await BibReconcile.patch({ receiptId })
    .set(setOps)
    .go({ response: "all_new" });
  return result.data;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Full reconciliation of an already-extracted payment:
 *   1. Create the BibReconcile ledger row (idempotent on receiptId).
 *      If it already exists, return early — earlier invocation handled it.
 *   2. Run the matcher (runnerCode primary + sender-name fallback).
 *   3. On match, apply payment to Bib + patch ledger status → "matched".
 *   4. On no match, patch ledger status → "unmatched".
 *
 * Caller is responsible for:
 *   - Passing a real Anthropic-extracted `extracted` (Task 22-04-01).
 *   - Passing a real receiptId derived from Message-ID (see receipt-id.mjs).
 *   - Deciding when to escalate to admin-email (Task 22-04-03).
 *
 * Test injection: `deps` overrides the entity-IO surface for unit tests.
 *
 * @param {object} args
 * @param {string} args.receiptId
 * @param {number} args.receivedAtMs
 * @param {{
 *   provider: "venmo"|"cashapp"|"unknown",
 *   amount_cents: number,
 *   sender_display_name: string,
 *   comment_text: string,
 *   confidence: string,
 * }} args.extracted
 * @param {object} [args.deps]  Test-injection surface.
 * @param {typeof createLedgerEntry} [args.deps.createLedgerEntry]
 * @param {typeof getBibByRunnerCode} [args.deps.getBibByRunnerCode]
 * @param {typeof listAllBibs} [args.deps.listAllBibs]
 * @param {typeof applyPaymentToBib} [args.deps.applyPaymentToBib]
 * @param {typeof updateReconcileStatus} [args.deps.updateReconcileStatus]
 * @returns {Promise<{
 *   receiptId: string,
 *   alreadyProcessed: boolean,
 *   status: "matched"|"unmatched"|"ambiguous",
 *   matchedOwnerSub?: string,
 *   matchStrategy: "runner_code"|"name_fallback"|"none",
 *   confidence: "high"|"medium"|"low",
 * }>}
 */
export async function reconcile({
  receiptId,
  receivedAtMs,
  extracted,
  deps = {},
}) {
  const _createLedgerEntry = deps.createLedgerEntry ?? createLedgerEntry;
  const _getBibByRunnerCode = deps.getBibByRunnerCode ?? getBibByRunnerCode;
  const _listAllBibs = deps.listAllBibs ?? listAllBibs;
  const _applyPaymentToBib = deps.applyPaymentToBib ?? applyPaymentToBib;
  const _updateReconcileStatus =
    deps.updateReconcileStatus ?? updateReconcileStatus;

  // Provider "unknown" is the extractor's way of saying "not a payment".
  // Don't burn a BibReconcile row on it — the notifier path (22-04-03)
  // decides whether to alarm.
  if (extracted.provider !== "venmo" && extracted.provider !== "cashapp") {
    return {
      receiptId,
      alreadyProcessed: false,
      status: "unmatched",
      matchStrategy: "none",
      confidence: "low",
    };
  }

  const ledgerInput = {
    receiptId,
    receivedAt: receivedAtMs,
    provider: extracted.provider,
    extractedAmount: extracted.amount_cents,
    extractedComment: extracted.comment_text,
    extractedSenderName: extracted.sender_display_name,
  };

  const { alreadyExists } = await _createLedgerEntry(ledgerInput);
  if (alreadyExists) {
    return {
      receiptId,
      alreadyProcessed: true,
      status: "matched", // Best guess — earlier invocation already ran.
      matchStrategy: "none",
      confidence: "low",
    };
  }

  const match = await reconcileExtractedPayment({
    extracted,
    getBibByRunnerCode: _getBibByRunnerCode,
    listAllBibs: _listAllBibs,
  });

  if (
    match.status === "matched" &&
    match.matchedOwnerSub &&
    Number.isInteger(extracted.amount_cents) &&
    extracted.amount_cents > 0
  ) {
    await _applyPaymentToBib({
      ownerSub: match.matchedOwnerSub,
      provider: extracted.provider,
      amount_cents: extracted.amount_cents,
      reconciled_via: `haiku_reconcile_${receiptId}`,
    });
    await _updateReconcileStatus(receiptId, {
      status: "matched",
      matchedOwnerSub: match.matchedOwnerSub,
    });
    return {
      receiptId,
      alreadyProcessed: false,
      status: "matched",
      matchedOwnerSub: match.matchedOwnerSub,
      matchStrategy: match.matchStrategy,
      confidence: match.confidence,
    };
  }

  await _updateReconcileStatus(receiptId, { status: "unmatched" });
  return {
    receiptId,
    alreadyProcessed: false,
    status: "unmatched",
    matchStrategy: match.matchStrategy,
    confidence: match.confidence,
  };
}
