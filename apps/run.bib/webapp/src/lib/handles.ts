import { getSecureParam } from "./ssm";

/**
 * Sponsor-provider handle resolution — Venmo + CashApp.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-02 + CONTEXT.md
 * "Locked design decisions"):
 * - Handles live in SSM as ordinary Strings (not SecureString) — they're
 *   public-facing `@defconrun` / `$defconrun` identifiers, not secrets.
 *   `getSecureParam` still works: WithDecryption=true on a String param
 *   is a documented AWS SSM no-op, so no separate helper is needed.
 * - Defaults `@defconrun` (Venmo) and `$defconrun` (CashApp) are the
 *   correct handles at v1.5 launch. Kurt may rotate within 24h of DEF
 *   CON; the SSM value overrides the default without a redeploy.
 * - SSM failure (dev without AWS creds, misconfigured param, network
 *   blip) MUST NOT 500 the instructions page — the page fails-open to
 *   the default. This matches the "handles are public + safe defaults"
 *   design and keeps the payment-instructions UX resilient during the
 *   race weekend.
 * - Env-var fallbacks `BIB_VENMO_HANDLE` / `BIB_CASHAPP_HANDLE` are
 *   honored (via getSecureParam's env-first order) for dev/CI overrides
 *   without hitting AWS.
 */

/** Public-facing Venmo handle default (Kurt-controlled brand ID). */
export const VENMO_HANDLE_DEFAULT = "@defconrun";

/** Public-facing Cash App handle default (Kurt-controlled brand ID). */
export const CASHAPP_HANDLE_DEFAULT = "$defconrun";

/** SSM parameter path for the Venmo handle override. */
export const VENMO_HANDLE_SSM_PATH = "/dc34/secrets/use1/bib/venmo/handle";

/** SSM parameter path for the Cash App handle override. */
export const CASHAPP_HANDLE_SSM_PATH = "/dc34/secrets/use1/bib/cashapp/handle";

/**
 * Resolve the Venmo handle. Env `BIB_VENMO_HANDLE` first, then SSM
 * (5-min-cached), then the compile-time default. Never throws — SSM
 * failures fall back to the default so the instructions page renders.
 */
export async function getVenmoHandle(): Promise<string> {
  try {
    return await getSecureParam({
      envKey: "BIB_VENMO_HANDLE",
      ssmPath: VENMO_HANDLE_SSM_PATH,
    });
  } catch (err) {
    // Log at info level — SSM misses in dev / preview are expected, and
    // we don't want to alarm operators. Prod misses (e.g., a rotated
    // path) will surface as the default handle in the UI, which is
    // still a correct payment target.
    console.info(
      "[run.bib] getVenmoHandle: SSM read failed, using default",
      err instanceof Error ? err.message : err
    );
    return VENMO_HANDLE_DEFAULT;
  }
}

/**
 * Resolve the Cash App handle. Same fail-open shape as
 * {@link getVenmoHandle}.
 */
export async function getCashAppHandle(): Promise<string> {
  try {
    return await getSecureParam({
      envKey: "BIB_CASHAPP_HANDLE",
      ssmPath: CASHAPP_HANDLE_SSM_PATH,
    });
  } catch (err) {
    console.info(
      "[run.bib] getCashAppHandle: SSM read failed, using default",
      err instanceof Error ? err.message : err
    );
    return CASHAPP_HANDLE_DEFAULT;
  }
}
