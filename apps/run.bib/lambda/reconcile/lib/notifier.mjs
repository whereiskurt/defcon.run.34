/**
 * Admin-notification email for unmatched / ambiguous / budget-exhausted
 * reconciliation outcomes.
 *
 * Sends via SES SendEmail from `bibpayment@run.defcon.run` to
 * `defcon.run@gmail.com`. Task 22-03-02's IAM policy caps both the
 * FromAddress and Recipients — the Lambda role literally cannot send to
 * any other recipient.
 *
 * Cold-start-cached SES client. Body payload includes the extracted
 * fields + the receipt excerpt (first 500 chars) so the operator can eye
 * the mismatch without hunting through S3.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/** SES client singleton (cold-start-only construction). */
let sesClient = null;
function getSesClient() {
  if (!sesClient) {
    sesClient = new SESClient({
      region: process.env.AWS_REGION || process.env.REGION_LABEL || "us-east-1",
    });
  }
  return sesClient;
}

/**
 * Compose subject + body for a reconcile-notification email.
 * Pure fn — no side effects, safe to unit-test.
 *
 * @param {object} args
 * @param {"unmatched"|"ambiguous"|"budget_exhausted"} args.reason
 * @param {string} args.receiptId
 * @param {object} [args.extracted] The Haiku extract (may be null if the
 *   budget-cap prologue never ran the extractor).
 * @param {string} [args.bodyExcerpt] First N chars of the parsed email body.
 * @param {string} [args.bucket]
 * @param {string} [args.key]
 * @returns {{subject: string, textBody: string}}
 */
export function composeNotificationEmail({
  reason,
  receiptId,
  extracted,
  bodyExcerpt,
  bucket,
  key,
}) {
  const subject = `[run.bib] reconcile ${reason} — ${receiptId}`;

  const lines = [
    `Reason: ${reason}`,
    `Receipt ID: ${receiptId}`,
  ];

  if (bucket && key) {
    lines.push(`S3: s3://${bucket}/${key}`);
  }

  if (extracted && typeof extracted === "object") {
    lines.push("");
    lines.push("Haiku extraction:");
    lines.push(`  provider: ${extracted.provider ?? "(none)"}`);
    lines.push(`  amount_cents: ${extracted.amount_cents ?? "(none)"}`);
    lines.push(`  sender_display_name: ${extracted.sender_display_name ?? "(none)"}`);
    lines.push(`  comment_text: ${extracted.comment_text ?? "(none)"}`);
    lines.push(`  confidence: ${extracted.confidence ?? "(none)"}`);
    if (extracted.notes) lines.push(`  notes: ${extracted.notes}`);
  }

  if (bodyExcerpt) {
    lines.push("");
    lines.push("Email body excerpt (first 500 chars):");
    lines.push(String(bodyExcerpt).slice(0, 500));
  }

  return { subject, textBody: lines.join("\n") };
}

/**
 * Send a notification email via SES. Client can be dependency-injected
 * for tests.
 *
 * @param {object} args
 * @param {"unmatched"|"ambiguous"|"budget_exhausted"} args.reason
 * @param {string} args.receiptId
 * @param {object} [args.extracted]
 * @param {string} [args.bodyExcerpt]
 * @param {string} [args.bucket]
 * @param {string} [args.key]
 * @param {SESClient} [args.client]  Test-injected SES client.
 * @param {string} [args.from]  Overrides env SES_FROM_ADDRESS (test-only).
 * @param {string} [args.to]  Overrides env SES_ADMIN_RECIPIENT (test-only).
 */
export async function sendReconcileNotification({
  reason,
  receiptId,
  extracted,
  bodyExcerpt,
  bucket,
  key,
  client,
  from,
  to,
}) {
  const senderAddress =
    from || process.env.SES_FROM_ADDRESS || "bibpayment@run.defcon.run";
  const adminRecipient =
    to || process.env.SES_ADMIN_RECIPIENT || "defcon.run@gmail.com";

  const { subject, textBody } = composeNotificationEmail({
    reason,
    receiptId,
    extracted,
    bodyExcerpt,
    bucket,
    key,
  });

  const cmd = new SendEmailCommand({
    Source: senderAddress,
    Destination: { ToAddresses: [adminRecipient] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: textBody, Charset: "UTF-8" },
      },
    },
  });

  const ses = client || getSesClient();
  return await ses.send(cmd);
}
