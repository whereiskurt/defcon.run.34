# AI-SPEC — v1.5 Phase 22 Payments (Haiku Reconciliation)

**Framework:** Anthropic SDK `@anthropic-ai/sdk` (Node.js 20+)
**Model:** `claude-haiku-4-5-20251001` (Haiku 4.5, released 2025-10-01)
**Task:** Structured extraction of `{amount_cents, comment_text, sender_display_name, provider}` from raw email bodies (Venmo or CashApp payment receipts)

## Framework Quick Reference

### SDK install

```bash
npm install @anthropic-ai/sdk
```

### Structured output pattern (tool use — recommended)

Haiku 4.5 supports **forced tool use** which reliably produces JSON-schema-valid structured output. Pattern:

```js
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tools = [{
  name: "record_payment",
  description: "Record a payment extracted from a forwarded receipt email.",
  input_schema: {
    type: "object",
    properties: {
      provider: { type: "string", enum: ["venmo", "cashapp", "unknown"] },
      amount_cents: { type: "integer", description: "Payment amount in cents. 0 if not extractable." },
      currency: { type: "string", enum: ["usd"], description: "Only USD supported at launch." },
      sender_display_name: { type: "string", description: "The person who sent the payment (best-effort display name from the email)." },
      comment_text: { type: "string", description: "Payment memo/comment from the sender. Empty string if not present." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "string", description: "Freeform reason for low/medium confidence, or empty." },
    },
    required: ["provider", "amount_cents", "currency", "sender_display_name", "comment_text", "confidence"],
  },
}];

const msg = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  tools,
  tool_choice: { type: "tool", name: "record_payment" },  // force call
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: RAW_EMAIL_BODY }],
});

// Extract the tool_use block
const toolUse = msg.content.find(b => b.type === "tool_use");
const extracted = toolUse.input;  // typed against input_schema
```

**Why forced tool use over prompt engineering:** Haiku sometimes returns extra prose around JSON if you just say "output JSON only." Forced `tool_choice` bypasses that entirely — the API guarantees the tool is called or fails. Schema validation happens at the API layer.

### System prompt (skeleton)

```
You extract payment details from forwarded email receipts.

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
- Comment text on Venmo is called "note"; on CashApp it's called "For" or "Memo".
```

### Pricing / Budget

Haiku 4.5 pricing (as of 2026-07): $1/M input tokens, $5/M output tokens (verify at request time via Anthropic pricing page).

For the reconciliation Lambda, typical request: ~500 input tokens (email body trimmed) + ~100 output tokens (tool call) = ~$0.001/invocation. $20/day cap = ~20,000 receipts/day — well above realistic Venmo/CashApp forwarding volume (Kurt/Jesse forward maybe 10-100/day).

## Venmo Receipt Format (public research 2026-07)

**Sender addresses observed:**
- `venmo@venmo.com`
- `no-reply@venmo.com`
- Legitimate sender domain is always `@venmo.com` per Venmo help center.

**Subject line patterns:**
- `<Sender First Name> paid you $<amount>` (most common)
- `You received a payment from <Sender>`
- `<Sender> paid you`

**Body key fields:**
- Sender display name (from Venmo profile)
- `@sender-handle` (Venmo username)
- Dollar amount (formatted `$X.XX`)
- Payment note (the reconciliation key for us — where `BIB-XXXX` will appear)
- Timestamp
- Transaction ID (not needed by us; email Message-ID handles dedupe)

**Extraction strategy:** Haiku reads the full body. `comment_text` = the payment note. `sender_display_name` = the profile name (NOT the @-handle) since the note usually references the sender's real name. If both are present in the body, Haiku prefers the profile name for `sender_display_name` and captures the note verbatim in `comment_text`.

## CashApp Receipt Format (public research 2026-07)

**Sender addresses observed:**
- `cash@square.com`
- `no-reply@cash.app`
- Legitimate sender domain: `@cash.app`, `@squareup.com`, or `@square.com` per CashApp help.

**Subject line patterns:**
- `You've received $<amount> from <Sender>`
- `<Sender> sent you $<amount>`

**Body key fields:**
- Sender display name + `$cashtag`
- Dollar amount
- "For:" or "Memo:" line (this is where `BIB-XXXX` appears)
- Timestamp
- Transaction status

**Extraction strategy:** Same as Venmo. Haiku prefers display name for `sender_display_name`; `comment_text` = the `For:` / `Memo:` value.

## Budget-Cap Strategy — RECOMMENDED

**Proposal:** In-Lambda daily counter via DynamoDB `BudgetCounter` entity.

**Why not CloudWatch:** CloudWatch alarms fire on aggregated metrics with a delay — a burst of receipts could blow through the cap before an alarm triggers. Also, CloudWatch doesn't stop invocations; it only alerts.

**Design:**
- New DDB entity `BudgetCounter` on the shared `run-human-electro` table:
  - `date` (PK, ISO date `YYYY-MM-DD`, UTC)
  - `costUsdCents` (accumulated)
  - `invocationCount`
- Lambda on invoke:
  1. `getBudget(today)` — read current counter
  2. If `costUsdCents >= 2000` (2000¢ = $20), skip Haiku call, mark `BibReconcile.status=ambiguous` with `notes: "daily_budget_exhausted"`, email admin, exit
  3. Otherwise call Haiku, then `updateBudget(today, +estimatedCostCents)`
- Cost estimation: assume ~$0.001/invocation (500 in + 100 out at Haiku 4.5 pricing). Conservative — overcounts slightly.
- Reset: no reset job needed; each new UTC day gets a fresh row (default `costUsdCents=0`).
- IAM: Lambda needs `dynamodb:GetItem` + `dynamodb:UpdateItem` on the shared electro table (same permissions the reconcile logic needs anyway).

**Alarm layer (optional):** CloudWatch alarm at 80% ($16/day) sends an SNS notification to `defcon.run@gmail.com` — early warning, non-blocking.

## Anthropic SDK notes for Lambda

- Set `timeout: 25000` on the client to fit within Lambda 30s timeout with margin (default SDK timeout is 600s).
- Retry: SDK auto-retries on 429/5xx with exponential backoff up to 2 retries by default — fine for us.
- Model ID pinning: `claude-haiku-4-5-20251001` (exact snapshot). Don't use latest-alias — avoids surprise model behavior drift.
- Response format: `content[]` is an array of blocks. For forced tool use, exactly one `tool_use` block will be present. Guard with `.find(b => b.type === "tool_use")` and null-check.

## Implementation notes for planner

- Lambda handler is `handler` (ES module `index.mjs` exports `handler`). Terragrunt module supports `runtime = "nodejs20.x"`.
- Package via `data "archive_file"` on `apps/run.bib/lambda/reconcile/` directory. Zip includes `node_modules/` — run `npm ci --omit=dev` at package time (Terragrunt local-exec hook or plain shell script pre-plan).
- Trigger: S3 PUT event on `ses-inbox-dc34-use1` scoped to `bib-payments/` prefix. Not SNS/SQS — direct S3-invoke is simplest.
- Email format from SES → S3: full raw MIME message. Use `mailparser` npm package to extract the body text; feed body text (not full MIME) to Haiku for token efficiency.
- Test locally: `apps/run.bib/lambda/reconcile/tests/fixtures/` with 2-3 synthetic email bodies (Venmo, CashApp, junk). Use `vitest` (already scaffolded in Plan 21-03).

## Model choice justification

Haiku 4.5 vs alternatives:
- **Haiku 4.5** (`claude-haiku-4-5-20251001`): $1/M in / $5/M out. Fast (~1s p50). Structured output via tool use = reliable. Chosen.
- **Sonnet 4.5**: $3/M in / $15/M out. Overkill for structured extraction; 3x cost.
- **Opus 4.7/4.8**: $15/M in / $75/M out. Massively overkill for this task.

Haiku 4.5 handles multi-lingual and unusual email formats well enough for launch. Escalate to Sonnet if we see systematically-low confidence over the first 100 real receipts.

Sources:
- [Notification Settings | Venmo](https://help.venmo.com/cs/articles/notification-settings-vhel258)
- [Unexpected Emails from Venmo | Venmo](https://help.venmo.com/cs/articles/unexpected-emails-from-venmo-vhel219)
- [Receiving a Payment | Cash App](https://cash.app/help/1111-receiving-a-payment)
- [How to spot fake Cash App payments, receipts, and screenshots](https://resistant.ai/blog/cash-app-scams)
