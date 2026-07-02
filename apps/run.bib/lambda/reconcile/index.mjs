/**
 * bib-reconcile Lambda — SES → S3 → Haiku extraction → BibReconcile
 *
 * Plan 22-04-01 wires:
 *   1. S3 event → GetObject on the raw MIME bytes SES wrote.
 *   2. `mailparser` normalizes the MIME into {bodyText, messageId, from,
 *      subject, receivedAtMs}.
 *   3. Haiku 4.5 with forced tool_use extracts
 *      {provider, amount_cents, currency, sender_display_name, comment_text,
 *      confidence, notes}.
 *
 * Later plans in this phase layer:
 *   - 22-04-02: matcher (runnerCode primary + sender fallback) + BibReconcile
 *     write + Bib.applyPayment atomic mutation.
 *   - 22-04-03: BudgetCounter cap check (short-circuit above $20/day) + SES
 *     admin notification on unmatched/ambiguous.
 *
 * Cold-start-only construction of the S3 + Anthropic clients keeps the p50
 * latency down; both are safe to reuse across invocations (SDK-level HTTP
 * keep-alive on the Node.js 22 runtime).
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";

import { SYSTEM_PROMPT, RECORD_PAYMENT_TOOL } from "./prompt.js";
import { parseReceiptEmail } from "./lib/parse-email.mjs";
import { extractPaymentFromEmail } from "./lib/haiku.mjs";
import { deriveReceiptId } from "./lib/receipt-id.mjs";
import { reconcile } from "./lib/reconcile.mjs";

// --- Cold-start client singletons ------------------------------------------

/**
 * Cached S3 client. The Lambda runtime reuses the module across warm
 * invocations, so a single client survives cold-start.
 * @type {S3Client|null}
 */
let s3Client = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.REGION_LABEL || "us-east-1",
    });
  }
  return s3Client;
}

/**
 * Cached Anthropic client. Constructed once per cold start — the API key
 * comes from ANTHROPIC_API_KEY env var (SSM-loader in production; direct
 * env in local test).
 * @type {Anthropic|null}
 */
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 25000,
    });
  }
  return anthropicClient;
}

// --- Utility: read S3 object to Buffer -------------------------------------

/**
 * Read an S3 object to a Buffer. GetObjectCommand returns a stream on Node —
 * consume it fully so mailparser has the whole MIME payload.
 *
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<Buffer>}
 */
async function s3GetObjectBuffer(bucket, key) {
  const client = getS3Client();
  const out = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const chunks = [];
  for await (const chunk of out.Body) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Process a single S3 record: fetch bytes, parse MIME, extract payment
 * fields via Haiku. Returns a diagnostic result summarising what was seen —
 * matcher / DDB writes land in Plan 22-04-02.
 *
 * @param {{bucket: {name: string}, object: {key: string}}} rec
 * @param {object} [ctx] Optional context (client injection for tests).
 * @param {import('@anthropic-ai/sdk').Anthropic} [ctx.anthropicClient]
 * @param {(bucket: string, key: string) => Promise<Buffer>} [ctx.readObject]
 */
export async function processS3Record(rec, ctx = {}) {
  const bucket = rec?.bucket?.name;
  const key = rec?.object?.key;
  if (!bucket || !key) {
    throw new Error("processS3Record: missing bucket or key");
  }

  const readObject = ctx.readObject || s3GetObjectBuffer;
  const raw = await readObject(bucket, key);
  const parsed = await parseReceiptEmail(raw);

  const extracted = await extractPaymentFromEmail({
    bodyText: parsed.bodyText,
    subject: parsed.subject ?? undefined,
    client: ctx.anthropicClient || getAnthropicClient(),
  });

  const receiptId = deriveReceiptId({
    messageId: parsed.messageId,
    bucket,
    key,
  });

  const reconcileResult = await reconcile({
    receiptId,
    receivedAtMs: parsed.receivedAtMs,
    extracted,
    deps: ctx.reconcileDeps,
  });

  return {
    bucket,
    key,
    messageId: parsed.messageId,
    receivedAtMs: parsed.receivedAtMs,
    from: parsed.from,
    subject: parsed.subject,
    extracted,
    reconcile: reconcileResult,
  };
}

/**
 * Lambda handler — S3 PUT event on `ses-inbox-dc34-use1/bib-payments/*`.
 *
 * Iterates records in-order; a single failure does not abort the whole
 * batch (SES writes one object per email, so batches are usually size 1,
 * but we're defensive). Errors are logged and swallowed so downstream
 * events still process; production alarms fire on `error=true` structured
 * logs.
 *
 * @param {import('aws-lambda').S3Event} event
 * @param {import('aws-lambda').Context} context
 */
export async function handler(event, context) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  const results = [];

  for (const r of records) {
    try {
      const s3rec = r?.s3;
      const outcome = await processS3Record(s3rec);
      console.log(
        JSON.stringify({
          msg: "bib-reconcile processed",
          requestId: context?.awsRequestId ?? null,
          bucket: outcome.bucket,
          key: outcome.key,
          messageId: outcome.messageId,
          provider: outcome.extracted.provider,
          amountCents: outcome.extracted.amount_cents,
          confidence: outcome.extracted.confidence,
          reconcileStatus: outcome.reconcile?.status,
          matchStrategy: outcome.reconcile?.matchStrategy,
          matchedOwnerSub: outcome.reconcile?.matchedOwnerSub ?? null,
          receiptId: outcome.reconcile?.receiptId,
        })
      );
      results.push({ ok: true, outcome });
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: "bib-reconcile record failed",
          requestId: context?.awsRequestId ?? null,
          error: true,
          message: err?.message ?? String(err),
          bucket: r?.s3?.bucket?.name ?? null,
          key: r?.s3?.object?.key ?? null,
        })
      );
      results.push({ ok: false, error: err?.message ?? String(err) });
    }
  }

  // Prompt + tool metadata retained on the returned shape so the smoke
  // test from Plan 22-03-01 keeps passing (it asserts stub markers).
  return {
    status: results.every((r) => r.ok) ? "ok" : "partial",
    records: records.length,
    processed: results.filter((r) => r.ok).length,
    promptChars: SYSTEM_PROMPT.length,
    toolName: RECORD_PAYMENT_TOOL.name,
  };
}
