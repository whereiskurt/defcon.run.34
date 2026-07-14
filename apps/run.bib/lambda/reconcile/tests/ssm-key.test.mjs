import { describe, it, expect } from "vitest";

/**
 * Anthropic API key resolution.
 *
 * Production wires only ANTHROPIC_API_KEY_SSM_PATH (the SSM parameter path) +
 * IAM GetParameter scoped to it — the key itself is NOT in the Lambda env.
 * resolveAnthropicApiKey fetches the decrypted value at cold start. A direct
 * ANTHROPIC_API_KEY (local test / override) short-circuits the SSM call.
 */

import { resolveAnthropicApiKey } from "../lib/ssm-key.mjs";

function fakeSsm(value, sink) {
  return {
    send: async (cmd) => {
      if (sink) sink.push(cmd);
      return { Parameter: { Value: value } };
    },
  };
}

describe("resolveAnthropicApiKey()", () => {
  it("returns a directly-set ANTHROPIC_API_KEY without touching SSM", async () => {
    let called = false;
    const ssmClient = { send: async () => { called = true; return {}; } };
    const key = await resolveAnthropicApiKey({
      env: { ANTHROPIC_API_KEY: "sk-direct", ANTHROPIC_API_KEY_SSM_PATH: "/x" },
      ssmClient,
    });
    expect(key).toBe("sk-direct");
    expect(called).toBe(false);
  });

  it("fetches the decrypted value from the SSM path when no direct key is set", async () => {
    const sink = [];
    const key = await resolveAnthropicApiKey({
      env: { ANTHROPIC_API_KEY_SSM_PATH: "/dc34/secrets/use1/bib/anthropic/api_key" },
      ssmClient: fakeSsm("sk-from-ssm", sink),
    });
    expect(key).toBe("sk-from-ssm");
    // Must request decryption of the exact path.
    expect(sink).toHaveLength(1);
    expect(sink[0].input).toMatchObject({
      Name: "/dc34/secrets/use1/bib/anthropic/api_key",
      WithDecryption: true,
    });
  });

  it("throws a clear error when neither key nor path is set", async () => {
    await expect(
      resolveAnthropicApiKey({ env: {}, ssmClient: fakeSsm("x") })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws when the SSM parameter resolves to an empty value", async () => {
    await expect(
      resolveAnthropicApiKey({
        env: { ANTHROPIC_API_KEY_SSM_PATH: "/x" },
        ssmClient: { send: async () => ({ Parameter: { Value: "" } }) },
      })
    ).rejects.toThrow(/\/x/);
  });
});
