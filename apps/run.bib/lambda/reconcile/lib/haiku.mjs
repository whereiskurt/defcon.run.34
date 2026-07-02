/**
 * Haiku 4.5 forced-tool-use extractor.
 *
 * Wraps `@anthropic-ai/sdk` messages.create with `tool_choice: {type:"tool",
 * name:"record_payment"}` so Anthropic guarantees a structured tool_use
 * response (no prose-around-JSON drift). See AI-SPEC.md §"Structured output
 * pattern".
 *
 * The Anthropic client is lazily constructed on first extract() call so the
 * SSM key fetch can be deferred until the module is loaded on cold-start (in
 * production, the API key comes from SSM via `getAnthropicClient()`; in tests
 * the client is dependency-injected).
 *
 * Model: `claude-haiku-4-5-20251001` — pinned snapshot from prompt.js.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  RECORD_PAYMENT_TOOL,
  HAIKU_MODEL_ID,
} from "../prompt.js";

/**
 * Extract payment fields from a receipt email body via Haiku 4.5 with forced
 * tool use.
 *
 * @param {object} opts
 * @param {string} opts.bodyText - Trimmed email body (see parseReceiptEmail).
 * @param {string} [opts.subject] - Subject line (helps Haiku on ambiguous
 *   bodies; passed as an extra line so the message stays a single string).
 * @param {import('@anthropic-ai/sdk').Anthropic} [opts.client] - Injected
 *   Anthropic client (for tests). If omitted, the module reads
 *   `ANTHROPIC_API_KEY` from the environment. Production callers should
 *   inject the SSM-loaded client from index.mjs.
 * @param {number} [opts.maxTokens=1024] - Haiku response token cap.
 *
 * @returns {Promise<{
 *   provider: "venmo"|"cashapp"|"unknown",
 *   amount_cents: number,
 *   currency: "usd",
 *   sender_display_name: string,
 *   comment_text: string,
 *   confidence: "high"|"medium"|"low",
 *   notes?: string,
 *   _raw: object,
 * }>}
 */
export async function extractPaymentFromEmail({
  bodyText,
  subject,
  client,
  maxTokens = 1024,
}) {
  if (typeof bodyText !== "string" || bodyText.length === 0) {
    throw new Error("extractPaymentFromEmail: bodyText is required");
  }

  const anthropic =
    client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 25000, // AI-SPEC §"Anthropic SDK notes for Lambda"
    });

  const userContent = subject
    ? `Subject: ${subject}\n\n${bodyText}`
    : bodyText;

  const msg = await anthropic.messages.create({
    model: HAIKU_MODEL_ID,
    max_tokens: maxTokens,
    tools: [RECORD_PAYMENT_TOOL],
    // Force the tool — schema validation happens at the API layer, no
    // "extra prose around JSON" failure mode.
    tool_choice: { type: "tool", name: "record_payment" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = Array.isArray(msg?.content)
    ? msg.content.find((b) => b?.type === "tool_use" && b?.name === "record_payment")
    : null;

  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new Error(
      "extractPaymentFromEmail: no record_payment tool_use block returned"
    );
  }

  const input = toolUse.input;

  // Defensive normalization — the API schema-validates but the client-side
  // check protects downstream consumers against future schema drift.
  return {
    provider:
      input.provider === "venmo" || input.provider === "cashapp"
        ? input.provider
        : "unknown",
    amount_cents: Number.isInteger(input.amount_cents)
      ? input.amount_cents
      : 0,
    currency: "usd",
    sender_display_name:
      typeof input.sender_display_name === "string"
        ? input.sender_display_name
        : "",
    comment_text:
      typeof input.comment_text === "string" ? input.comment_text : "",
    confidence:
      input.confidence === "high" ||
      input.confidence === "medium" ||
      input.confidence === "low"
        ? input.confidence
        : "low",
    notes: typeof input.notes === "string" ? input.notes : "",
    _raw: input,
  };
}
