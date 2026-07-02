import { describe, it, expect } from "vitest";

/**
 * Smoke test for Plan 22-03-01 scaffold. Confirms:
 *   1. `index.mjs` imports cleanly (no missing prompt.js reference).
 *   2. The handler export exists and is invocable with an empty S3 event.
 *   3. `prompt.js` exports the expected shape (system prompt string +
 *      forced tool_use tool definition).
 *
 * Plan 22-04-01 replaces these with fixture-driven extraction tests.
 */

import { handler } from "../index.mjs";
import {
  SYSTEM_PROMPT,
  RECORD_PAYMENT_TOOL,
  HAIKU_MODEL_ID,
} from "../prompt.js";

describe("bib-reconcile Lambda stub (Plan 22-03-01)", () => {
  it("exports a callable handler", () => {
    expect(typeof handler).toBe("function");
  });

  it("returns stub-ok on an empty S3 event without throwing", async () => {
    const result = await handler(
      { Records: [] },
      { awsRequestId: "test-req-1" }
    );
    expect(result).toEqual({
      status: "stub-ok",
      records: 0,
      stub: true,
    });
  });

  it("counts records when passed a synthetic S3 event", async () => {
    const event = {
      Records: [
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: "ses-inbox-dc34-use1" },
            object: { key: "bib-payments/fake-1" },
          },
        },
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: "ses-inbox-dc34-use1" },
            object: { key: "bib-payments/fake-2" },
          },
        },
      ],
    };
    const result = await handler(event, { awsRequestId: "test-req-2" });
    expect(result.records).toBe(2);
    expect(result.stub).toBe(true);
  });
});

describe("prompt module (Plan 22-03-01)", () => {
  it("exports a non-empty system prompt", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200);
    // The prompt must reference the reconciliation-relevant fields verbatim
    // from AI-SPEC.md so drift here forces test-file review.
    expect(SYSTEM_PROMPT).toContain("amount_cents");
    expect(SYSTEM_PROMPT).toContain("comment_text");
    expect(SYSTEM_PROMPT).toContain("provider");
  });

  it("declares the forced-tool-use record_payment tool", () => {
    expect(RECORD_PAYMENT_TOOL.name).toBe("record_payment");
    const schema = RECORD_PAYMENT_TOOL.input_schema;
    expect(schema.type).toBe("object");
    // Required fields from AI-SPEC §"Structured output pattern".
    for (const field of [
      "provider",
      "amount_cents",
      "currency",
      "sender_display_name",
      "comment_text",
      "confidence",
    ]) {
      expect(schema.required).toContain(field);
      expect(schema.properties).toHaveProperty(field);
    }
    // provider must include all three enum values so the extractor can
    // return "unknown" on junk email.
    expect(schema.properties.provider.enum).toEqual([
      "venmo",
      "cashapp",
      "unknown",
    ]);
  });

  it("pins the Haiku 4.5 snapshot model id", () => {
    // Exact snapshot from AI-SPEC.md — do NOT switch to `-latest`.
    expect(HAIKU_MODEL_ID).toBe("claude-haiku-4-5-20251001");
  });
});
