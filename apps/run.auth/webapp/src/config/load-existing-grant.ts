import type { Configuration } from "oidc-provider";

/**
 * Auto-consent decision for the first-party OIDC allowlist.
 *
 * This module is intentionally free of app-specific literals so the mint / reuse /
 * undefined branches are unit-testable without a live Provider. The allowlist and the
 * grant-minting side effect are dependency-injected via {@link makeLoadExistingGrant}.
 *
 * Security (T-33-01): auto-consent is bounded to the injected `firstPartyClientIds`
 * allowlist. Any client_id outside it (or a request with no authenticated account)
 * resolves `undefined`, falling back to the provider's default interaction flow.
 */

export interface LoadExistingGrantDeps {
  /** Registered first-party client ids that may be auto-consented. */
  firstPartyClientIds: string[];
  /**
   * Mints and persists a grant covering the requested scope, returning the new grant id.
   * Injected so the pure decision logic never touches the live Provider directly.
   */
  createGrant: (args: {
    accountId: string;
    clientId: string;
    scope?: string;
  }) => Promise<string>;
}

type LoadExistingGrantHook = NonNullable<Configuration["loadExistingGrant"]>;

/**
 * Build a `loadExistingGrant(ctx)` provider hook.
 *
 * Behaviour:
 * - No authenticated account, or a client_id outside the allowlist → resolves `undefined`
 *   (no auto-consent; default flow runs).
 * - First-party client with an already-recorded grant → reuses it (no new mint).
 * - First-party client with no grant → mints one covering `ctx.oidc.params.scope`,
 *   records the mapping on the session, and returns the loaded grant.
 */
export function makeLoadExistingGrant(
  deps: LoadExistingGrantDeps
): LoadExistingGrantHook {
  const allowlist = new Set(deps.firstPartyClientIds);

  const loadExistingGrant: LoadExistingGrantHook = async (ctx) => {
    const account = ctx.oidc.account;
    const clientId = ctx.oidc.client?.clientId;
    const scope = ctx.oidc.params?.scope;
    const session = ctx.oidc.session;

    // A grant approved by a just-completed interaction takes precedence over
    // everything else (mirrors the provider's default hook). This is not
    // auto-consent — the user/interaction already approved it — so it is NOT
    // gated on the allowlist. Skipping this branch made authorize resumes
    // ignore the handler's freshly minted grant and loop on op_scopes_missing.
    const submittedGrantId = (ctx.oidc.result as { consent?: { grantId?: string } } | undefined)
      ?.consent?.grantId;
    if (submittedGrantId) {
      const submitted = await ctx.oidc.provider.Grant.find(submittedGrantId);
      if (submitted) {
        return submitted;
      }
    }

    // No auto-consent without an authenticated account or for unknown clients.
    if (!account || !clientId || !allowlist.has(clientId)) {
      return undefined;
    }

    // Reuse an existing recorded grant when the session already has one for this
    // client — but only if the record still exists. A Session (15-day TTL) can
    // outlive its recorded Grant (14-day TTL); returning undefined here made
    // oidc-provider substitute an empty grant and re-prompt consent forever.
    // Fall through to mint a replacement instead.
    const existingGrantId = session?.grantIdFor(clientId);
    if (existingGrantId) {
      const existing = await ctx.oidc.provider.Grant.find(existingGrantId);
      if (existing) {
        return existing;
      }
    }

    // Otherwise mint a grant for the requested scope and record it on the session.
    // Note: oidc-provider@9 records the mapping via the two-argument grantIdFor(clientId, value)
    // setter overload (there is no ensureGrantId method in v9).
    const grantId = await deps.createGrant({
      accountId: account.accountId,
      clientId,
      scope: typeof scope === "string" ? scope : undefined,
    });
    session?.grantIdFor(clientId, grantId);
    return ctx.oidc.provider.Grant.find(grantId);
  };

  return loadExistingGrant;
}
