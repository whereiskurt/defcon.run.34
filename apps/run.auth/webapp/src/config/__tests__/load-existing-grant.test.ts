import { describe, it, expect, vi } from "vitest";
import { makeLoadExistingGrant } from "../load-existing-grant";

/**
 * Unit tests for the auto-consent decision (T-33-01 allowlist boundary).
 *
 * The factory is exercised with injected fakes only — a spy createGrant and a fake
 * ctx exposing the oidc-provider surface the hook reads. No live Provider needed.
 */

const FIRST_PARTY = ["client-alpha", "client-beta"];

/**
 * Build a fake KoaContextWithOIDC-shaped object.
 *
 * `existingGrantId` seeds session.grantIdFor(clientId) (the getter overload). The
 * two-argument setter overload records into `recorded`. provider.Grant.find is an
 * identity stub so the resolved value is the grant id under test.
 */
function makeCtx(opts: {
  account?: { accountId: string };
  clientId?: string;
  scope?: string;
  existingGrantId?: string;
}) {
  const recorded: Record<string, string> = {};
  const grantIdFor = vi.fn((clientId: string, value?: string) => {
    if (value === undefined) {
      return recorded[clientId] ?? opts.existingGrantId;
    }
    recorded[clientId] = value;
    return undefined;
  });
  const find = vi.fn(async (id: string) => id);

  const ctx = {
    oidc: {
      account: opts.account,
      client: opts.clientId ? { clientId: opts.clientId } : undefined,
      params: { scope: opts.scope },
      session: { grantIdFor },
      provider: { Grant: { find } },
    },
  };

  // Cast to any at the call site: the hook only touches the subset modelled above.
  return { ctx: ctx as any, grantIdFor, find, recorded };
}

describe("makeLoadExistingGrant", () => {
  it("(a) returns undefined for an unknown client and never mints a grant", async () => {
    const createGrant = vi.fn(async () => "grant-new");
    const hook = makeLoadExistingGrant({
      firstPartyClientIds: FIRST_PARTY,
      createGrant,
    });

    const { ctx } = makeCtx({
      account: { accountId: "acct-1" },
      clientId: "client-unknown",
      scope: "openid profile",
    });

    await expect(hook(ctx)).resolves.toBeUndefined();
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("(a') returns undefined when there is no authenticated account", async () => {
    const createGrant = vi.fn(async () => "grant-new");
    const hook = makeLoadExistingGrant({
      firstPartyClientIds: FIRST_PARTY,
      createGrant,
    });

    const { ctx } = makeCtx({
      account: undefined,
      clientId: "client-alpha",
      scope: "openid",
    });

    await expect(hook(ctx)).resolves.toBeUndefined();
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("(b) mints a grant with the requested scope, records it, and returns the new id", async () => {
    const createGrant = vi.fn(async () => "grant-new");
    const hook = makeLoadExistingGrant({
      firstPartyClientIds: FIRST_PARTY,
      createGrant,
    });

    const { ctx, grantIdFor, recorded } = makeCtx({
      account: { accountId: "acct-1" },
      clientId: "client-alpha",
      scope: "openid profile email",
      existingGrantId: undefined,
    });

    await expect(hook(ctx)).resolves.toBe("grant-new");

    // Minted exactly once with the requested scope passed through.
    expect(createGrant).toHaveBeenCalledTimes(1);
    expect(createGrant).toHaveBeenCalledWith({
      accountId: "acct-1",
      clientId: "client-alpha",
      scope: "openid profile email",
    });

    // Mapping recorded on the session via the two-arg setter overload.
    expect(grantIdFor).toHaveBeenCalledWith("client-alpha", "grant-new");
    expect(recorded["client-alpha"]).toBe("grant-new");
  });

  it("(c) reuses an already-recorded grant and does not mint", async () => {
    const createGrant = vi.fn(async () => "grant-new");
    const hook = makeLoadExistingGrant({
      firstPartyClientIds: FIRST_PARTY,
      createGrant,
    });

    const { ctx, find } = makeCtx({
      account: { accountId: "acct-1" },
      clientId: "client-beta",
      scope: "openid",
      existingGrantId: "grant-existing",
    });

    await expect(hook(ctx)).resolves.toBe("grant-existing");
    expect(createGrant).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledWith("grant-existing");
  });
});
