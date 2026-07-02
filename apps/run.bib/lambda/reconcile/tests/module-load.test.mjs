import { describe, it, expect } from "vitest";

/**
 * Smoke test — kept from Plan 22-03-01, updated for the Plan 22-04-01
 * handler shape (stub removed; handler now processes records but returns a
 * benign response on an empty S3 event).
 *
 * Confirms:
 *   1. `index.mjs` imports cleanly (no missing dep at cold start).
 *   2. The handler is invocable with an empty S3 event without throwing.
 *   3. `prompt.js` exports the expected shape (system prompt string +
 *      forced tool_use tool definition).
 */

import { handler } from "../index.mjs";
import {
  SYSTEM_PROMPT,
  RECORD_PAYMENT_TOOL,
  HAIKU_MODEL_ID,
} from "../prompt.js";

describe("bib-reconcile Lambda smoke (Plan 22-04-01)", () => {
  it("exports a callable handler", () => {
    expect(typeof handler).toBe("function");
  });

  it("returns status=ok on an empty S3 event without throwing", async () => {
    const result = await handler(
      { Records: [] },
      { awsRequestId: "test-req-1" }
    );
    expect(result.status).toBe("ok");
    expect(result.records).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.toolName).toBe("record_payment");
    expect(result.promptChars).toBe(SYSTEM_PROMPT.length);
  });
});

describe("prompt module (retained from Plan 22-03-01)", () => {
  it("exports a non-empty system prompt", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(SYSTEM_PROMPT).toContain("amount_cents");
    expect(SYSTEM_PROMPT).toContain("comment_text");
    expect(SYSTEM_PROMPT).toContain("provider");
  });

  it("declares the forced-tool-use record_payment tool", () => {
    expect(RECORD_PAYMENT_TOOL.name).toBe("record_payment");
    const schema = RECORD_PAYMENT_TOOL.input_schema;
    expect(schema.type).toBe("object");
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
    expect(schema.properties.provider.enum).toEqual([
      "venmo",
      "cashapp",
      "unknown",
    ]);
  });

  it("pins the Haiku 4.5 snapshot model id", () => {
    expect(HAIKU_MODEL_ID).toBe("claude-haiku-4-5-20251001");
  });
});
