/**
 * bib-reconcile Lambda — SES → S3 → Haiku extraction → BibReconcile
 *
 * This file is a STUB scaffolded in Plan 22-03-01. Real handler logic (Haiku
 * extraction + matcher + budget cap) lands in Plan 22-04. The stub exists so
 * that:
 *   1. The Terragrunt module (Plan 22-03-02) has a real `index.mjs` to zip.
 *   2. The `handler` export is present with a stable signature that the
 *      Lambda function_definition can bind (`handler = "index.handler"`).
 *   3. `data "archive_file"` produces a non-empty deployable artifact,
 *      allowing Plan 22-03-03 to plan/apply without waiting on 22-04.
 *
 * When invoked by an S3 PUT event on `ses-inbox-dc34-use1/bib-payments/*`,
 * the stub logs the event shape and returns success. It does NOT read from
 * S3, call Anthropic, or write to DDB — those hooks are added incrementally
 * in Plan 22-04-01 (Haiku extraction), 22-04-02 (matcher), 22-04-03 (budget
 * cap + admin email).
 *
 * The stub imports the shared prompt module and the BudgetCounter cap
 * checker so the packaged zip includes those dependencies from day one.
 * Nothing in the stub actually calls Haiku or DDB — the imports are lazy
 * (`await import()` inside the handler body would be equivalent) but done
 * at module load for a fail-fast cold-start signal if a dep is missing.
 */

// Static imports at the top so any missing dep surfaces at cold start,
// not on first request. All heavy imports (Anthropic SDK, mailparser,
// AWS SDK clients) will land in 22-04.
import { SYSTEM_PROMPT, RECORD_PAYMENT_TOOL } from "./prompt.js";

/**
 * Lambda handler.
 *
 * @param {import('aws-lambda').S3Event} event - S3 PUT notification.
 * @param {import('aws-lambda').Context} context - Lambda runtime context.
 * @returns {Promise<{status: string, records: number, stub: true}>}
 */
export async function handler(event, context) {
  const records = Array.isArray(event?.Records) ? event.Records : [];

  // Structured cold-start log so CloudWatch shows the stub is wired up
  // correctly. Real handler will use a shared logger; keep it plain here.
  console.log(
    JSON.stringify({
      msg: "bib-reconcile stub invoked",
      requestId: context?.awsRequestId ?? null,
      recordCount: records.length,
      promptChars: SYSTEM_PROMPT.length,
      toolName: RECORD_PAYMENT_TOOL.name,
      stub: true,
    })
  );

  // No-op: real reconciliation logic lives in Plan 22-04.
  return {
    status: "stub-ok",
    records: records.length,
    stub: true,
  };
}
