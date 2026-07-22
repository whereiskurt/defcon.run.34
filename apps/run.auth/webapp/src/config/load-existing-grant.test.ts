import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeLoadExistingGrant, type LoadExistingGrantDeps } from "./load-existing-grant";

/**
 * Regression tests for the 2026-07-22 production consent redirect loop.
 *
 * Incident: a user whose provider Session (15-day TTL) outlived its recorded
 * Grant (14-day TTL) got stuck in an infinite /auth/<uid> <-> /interaction/<uid>
 * loop (~40 interactions in 11s) because this hook:
 *   1. never consulted ctx.oidc.result.consent.grantId (the grant the
 *      interaction handler had just minted and submitted), and
 *   2. returned Grant.find(staleId) === undefined instead of falling through
 *      to mint when the session's recorded grant no longer exists.
 * oidc-provider then substituted an empty Grant -> op_scopes_missing ->
 * new consent interaction -> handler mints another (ignored) grant -> loop.
 */

const CLIENT_ID = "first-party-client";
const ACCOUNT_ID = "account-123";

function makeCtx(overrides: {
  resultGrantId?: string;
  recordedGrantId?: string;
  grants?: Record<string, { accountId: string; clientId: string }>;
  account?: boolean;
  clientId?: string;
}) {
  const grants = overrides.grants ?? {};
  const grantIdForSetter = vi.fn();
  return {
    grantIdForSetter,
    ctx: {
      oidc: {
        account: overrides.account === false ? undefined : { accountId: ACCOUNT_ID },
        client: { clientId: overrides.clientId ?? CLIENT_ID },
        params: { scope: "openid profile email services" },
        result: overrides.resultGrantId
          ? { consent: { grantId: overrides.resultGrantId } }
          : undefined,
        session: {
          grantIdFor: (clientId: string, value?: string) => {
            if (value !== undefined) {
              grantIdForSetter(clientId, value);
              return undefined;
            }
            return overrides.recordedGrantId;
          },
        },
        provider: {
          Grant: {
            find: vi.fn(async (id: string) => grants[id]),
          },
        },
      },
    } as any,
  };
}

describe("makeLoadExistingGrant", () => {
  let deps: LoadExistingGrantDeps;
  let minted: string[];

  beforeEach(() => {
    minted = [];
    deps = {
      firstPartyClientIds: [CLIENT_ID],
      createGrant: vi.fn(async () => {
        const id = `minted-${minted.length}`;
        minted.push(id);
        return id;
      }),
    };
  });

  it("prefers the grant submitted by a just-completed interaction (result.consent.grantId)", async () => {
    // The production loop: handler submits fresh-grant, session still records stale-grant.
    const freshGrant = { accountId: ACCOUNT_ID, clientId: CLIENT_ID };
    const { ctx } = makeCtx({
      resultGrantId: "fresh-grant",
      recordedGrantId: "stale-grant", // Grant.find("stale-grant") -> undefined (TTL-expired)
      grants: { "fresh-grant": freshGrant },
    });

    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(grant).toBe(freshGrant);
    expect(deps.createGrant).not.toHaveBeenCalled();
  });

  it("honours result.consent.grantId even for clients outside the auto-consent allowlist", async () => {
    // Matches oidc-provider's default hook: loading an interaction-approved grant
    // is not auto-consent, so the allowlist must not block it.
    const approved = { accountId: ACCOUNT_ID, clientId: "third-party" };
    const { ctx } = makeCtx({
      resultGrantId: "approved-grant",
      clientId: "third-party",
      grants: { "approved-grant": approved },
    });

    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(grant).toBe(approved);
  });

  it("mints a replacement when the session's recorded grant has expired (the loop bug)", async () => {
    // Session TTL (15d) > Grant TTL (14d): recorded grantId points at a
    // TTL-deleted record. Must fall through to mint, not return undefined.
    const { ctx, grantIdForSetter } = makeCtx({
      recordedGrantId: "stale-grant",
      grants: {}, // stale-grant is gone
    });
    // the freshly minted grant must be findable
    (ctx.oidc.provider.Grant.find as any).mockImplementation(async (id: string) =>
      id === "minted-0" ? { accountId: ACCOUNT_ID, clientId: CLIENT_ID } : undefined
    );

    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(deps.createGrant).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      clientId: CLIENT_ID,
      scope: "openid profile email services",
    });
    expect(grant).toEqual({ accountId: ACCOUNT_ID, clientId: CLIENT_ID });
    expect(grantIdForSetter).toHaveBeenCalledWith(CLIENT_ID, "minted-0");
  });

  it("reuses a live recorded grant without minting", async () => {
    const live = { accountId: ACCOUNT_ID, clientId: CLIENT_ID };
    const { ctx } = makeCtx({
      recordedGrantId: "live-grant",
      grants: { "live-grant": live },
    });

    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(grant).toBe(live);
    expect(deps.createGrant).not.toHaveBeenCalled();
  });

  it("mints on first authorization for a first-party client with no recorded grant", async () => {
    const { ctx } = makeCtx({ grants: {} });
    (ctx.oidc.provider.Grant.find as any).mockImplementation(async (id: string) =>
      id === "minted-0" ? { accountId: ACCOUNT_ID, clientId: CLIENT_ID } : undefined
    );

    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(deps.createGrant).toHaveBeenCalledOnce();
    expect(grant).toBeDefined();
  });

  it("returns undefined for unknown clients with no interaction result (no auto-consent)", async () => {
    const { ctx } = makeCtx({ clientId: "third-party" });
    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(grant).toBeUndefined();
    expect(deps.createGrant).not.toHaveBeenCalled();
  });

  it("returns undefined with no authenticated account and no interaction result", async () => {
    const { ctx } = makeCtx({ account: false });
    const grant = await makeLoadExistingGrant(deps)(ctx);
    expect(grant).toBeUndefined();
  });
});
