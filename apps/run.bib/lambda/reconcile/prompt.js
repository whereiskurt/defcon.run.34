/**
 * Haiku system prompt + tool schema for the bib-reconcile Lambda.
 *
 * Verbatim from AI-SPEC.md §"System prompt (skeleton)". Kept in its own
 * module (not inlined into index.mjs) so prompt iteration during Plan 22-04
 * doesn't churn the handler and so unit tests can assert the prompt shape
 * without importing the AWS SDK graph.
 *
 * Model: claude-haiku-4-5-20251001 (pinned snapshot, not latest-alias).
 */

/** @type {string} */
export const SYSTEM_PROMPT = `You extract payment details from forwarded email receipts.

Rules:
- Only USD payments; if currency is not USD, set amount_cents=0 and confidence="low".
- amount_cents: convert dollars.cents to integer cents ($10.50 → 1050).
- comment_text: verbatim payment memo/comment from the sender. Do not paraphrase.
- If the email is clearly not a Venmo or CashApp receipt, set provider="unknown", amount_cents=0, confidence="low".
- If any single field is ambiguous, set confidence="medium" or "low" and explain in notes.
- Never invent an amount. Empty comment_text is preferable to a guess.

Provider hints:
- Venmo emails typically come from a *@venmo.com address. Subject often contains "paid you", "sent you", "You received", or the sender's name and a dollar amount.
- CashApp emails typically come from *@cash.app, *@square.com, or *@squareup.com. Subject often contains "You've received", "$cashtag", or the sender's name.
- Comment text on Venmo is called "note"; on CashApp it's called "For" or "Memo".`;

/**
 * Tool definition passed to `messages.create({ tools: [RECORD_PAYMENT_TOOL] })`
 * with `tool_choice: { type: "tool", name: "record_payment" }` to force
 * structured extraction. Schema exact from AI-SPEC.md §"Structured output
 * pattern".
 *
 * @type {{name: string, description: string, input_schema: object}}
 */
export const RECORD_PAYMENT_TOOL = {
  name: "record_payment",
  description:
    "Record a payment extracted from a forwarded receipt email.",
  input_schema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["venmo", "cashapp", "unknown"],
      },
      amount_cents: {
        type: "integer",
        description:
          "Payment amount in cents. 0 if not extractable.",
      },
      currency: {
        type: "string",
        enum: ["usd"],
        description: "Only USD supported at launch.",
      },
      sender_display_name: {
        type: "string",
        description:
          "The person who sent the payment (best-effort display name from the email).",
      },
      comment_text: {
        type: "string",
        description:
          "Payment memo/comment from the sender. Empty string if not present.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      notes: {
        type: "string",
        description:
          "Freeform reason for low/medium confidence, or empty.",
      },
    },
    required: [
      "provider",
      "amount_cents",
      "currency",
      "sender_display_name",
      "comment_text",
      "confidence",
    ],
  },
};

/**
 * Anthropic model ID pinned to the 2025-10-01 Haiku 4.5 snapshot. Do NOT
 * use `claude-haiku-4-5-latest` — snapshot pinning avoids surprise
 * behaviour drift on prompt reconciliation.
 *
 * @type {string}
 */
export const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";
