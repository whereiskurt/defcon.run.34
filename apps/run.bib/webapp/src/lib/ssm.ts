import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

/**
 * SSM parameter cache (5-min TTL).
 *
 * Phase 22 introduces the first webapp-side SSM read for run.bib
 * (Stripe secret key, Stripe webhook signing secret, later Venmo /
 * CashApp handle overrides). No pre-existing SSM helper existed in
 * apps/run.human/ or apps/run.auth/ to mirror — this module
 * establishes the shared convention.
 *
 * Design contract (v1.5 Phase 22 PATTERNS.md §"Naming / config conventions"):
 * - 5-minute in-memory TTL matches typical ECS Fargate task lifetime;
 *   restart-on-fail rotates naturally without needing a longer cache.
 * - Cache is process-local — every ECS task refreshes on cold start.
 * - `WithDecryption: true` — always. All Phase 22 secrets are SecureString.
 * - Reads env fallback `env[envKey]` first (dev/CI convenience) before
 *   hitting AWS. `NODE_ENV=production` still checks env first so a bad
 *   Terraform push can hot-patch a param without a full redeploy.
 * - On SSM failure, throws — caller decides whether to fail-open or 503.
 *   (The webhook route returns 503 on placeholder-mode; the checkout
 *   route surfaces the error as a 500 so the frontend can retry.)
 *
 * Region: pinned via `AWS_REGION` (ECS Fargate injects this) with a
 * fallback to `us-east-1` so tests + local dev without ambient AWS creds
 * still construct a client (they won't be able to call GetParameter
 * without creds, but the fallback keeps typing sound).
 */

const SSM_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Process-local cache. Keyed by `${envKey}:${ssmPath}` so a param that
 * shows up under two env keys (e.g. dev fallback + prod SSM path) can
 * cache independently.
 */
const cache = new Map<string, CacheEntry>();

let ssmClient: SSMClient | null = null;

function getSsmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return ssmClient;
}

/**
 * Read a SecureString parameter, preferring an env-var fallback for dev.
 *
 * @param opts.envKey    Env var name checked before SSM. If set and
 *                       non-empty, its value is returned directly (not
 *                       cached — env vars are already process-local).
 * @param opts.ssmPath   Full SSM path (e.g. `/dc34/secrets/use1/bib/stripe/secret_key`).
 * @param opts.ttlMs     Cache TTL override (default 5 min).
 * @throws Error when both env is empty AND SSM GetParameter fails, so the
 *   caller can decide 503 (placeholder mode) vs 500 (real infra failure).
 */
export async function getSecureParam(opts: {
  envKey: string;
  ssmPath: string;
  ttlMs?: number;
}): Promise<string> {
  const { envKey, ssmPath, ttlMs = SSM_CACHE_TTL_MS } = opts;

  // Env-first: dev/CI convenience. Prod ECS tasks won't have these set.
  const envValue = process.env[envKey];
  if (envValue && envValue.length > 0) {
    return envValue;
  }

  // Cache hit (process-local, TTL-scoped).
  const cacheKey = `${envKey}:${ssmPath}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const client = getSsmClient();
  const cmd = new GetParameterCommand({
    Name: ssmPath,
    WithDecryption: true,
  });
  const res = await client.send(cmd);
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(
      `SSM parameter ${ssmPath} returned no Value (env fallback ${envKey} also empty)`
    );
  }

  cache.set(cacheKey, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Test-only: clear the process-local cache.
 * Not exported for general use — call from vitest teardown only.
 */
export function __resetSsmCacheForTests(): void {
  cache.clear();
  ssmClient = null;
}
