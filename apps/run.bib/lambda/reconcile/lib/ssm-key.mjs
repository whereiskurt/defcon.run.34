/**
 * Anthropic API key resolution for the reconcile Lambda.
 *
 * Production wires only `ANTHROPIC_API_KEY_SSM_PATH` (a SecureString parameter
 * path) plus IAM GetParameter scoped to it — the key itself is deliberately
 * NOT placed in the Lambda env. This fetches the decrypted value at cold
 * start. A directly-set `ANTHROPIC_API_KEY` (local dev / test override)
 * short-circuits the SSM call.
 */

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

/**
 * @param {object}  [opts]
 * @param {Record<string,string|undefined>} [opts.env]  Defaults to process.env.
 * @param {{send: Function}} [opts.ssmClient]  Injectable SSM client (tests).
 * @returns {Promise<string>} the resolved API key
 */
export async function resolveAnthropicApiKey({ env = process.env, ssmClient } = {}) {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;

  const path = env.ANTHROPIC_API_KEY_SSM_PATH;
  if (!path) {
    throw new Error(
      "resolveAnthropicApiKey: neither ANTHROPIC_API_KEY nor ANTHROPIC_API_KEY_SSM_PATH is set"
    );
  }

  const client =
    ssmClient ||
    new SSMClient({
      region: env.AWS_REGION || env.REGION_LABEL || "us-east-1",
    });

  const out = await client.send(
    new GetParameterCommand({ Name: path, WithDecryption: true })
  );
  const value = out?.Parameter?.Value;
  if (!value) {
    throw new Error(
      `resolveAnthropicApiKey: SSM parameter ${path} returned no value`
    );
  }
  return value;
}
