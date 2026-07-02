import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSsmCacheForTests } from "@/lib/ssm";

/**
 * Sponsor-handle resolution unit tests (Plan 22-02-01).
 *
 * The handles module wraps getSecureParam with a fail-open default so
 * a broken SSM path or a missing AWS credential in dev/CI doesn't 500
 * the payment-instructions page. These tests pin three invariants:
 *
 *   1. Env-var fallback is honored (dev/CI convenience — no AWS creds).
 *   2. SSM failure returns the compile-time default (fail-open).
 *   3. Default constants match the CONTEXT.md brand identifiers.
 *
 * We mock `@/lib/ssm` at the module boundary so we don't need real AWS
 * credentials or a network call. The env-var path uses the real
 * getSecureParam (env-first short-circuits before SSM).
 */

describe("handles module — constants", () => {
  it("pins Venmo default to @defconrun (CONTEXT.md brand contract)", async () => {
    const mod = await import("@/lib/handles");
    expect(mod.VENMO_HANDLE_DEFAULT).toBe("@defconrun");
  });

  it("pins Cash App default to $defconrun (CONTEXT.md brand contract)", async () => {
    const mod = await import("@/lib/handles");
    expect(mod.CASHAPP_HANDLE_DEFAULT).toBe("$defconrun");
  });

  it("pins SSM paths to the /dc34/secrets/use1/bib/{provider}/handle shape", async () => {
    const mod = await import("@/lib/handles");
    expect(mod.VENMO_HANDLE_SSM_PATH).toBe(
      "/dc34/secrets/use1/bib/venmo/handle"
    );
    expect(mod.CASHAPP_HANDLE_SSM_PATH).toBe(
      "/dc34/secrets/use1/bib/cashapp/handle"
    );
  });
});

describe("getVenmoHandle() + getCashAppHandle() — env fallback", () => {
  const originalVenmo = process.env.BIB_VENMO_HANDLE;
  const originalCashApp = process.env.BIB_CASHAPP_HANDLE;

  beforeEach(() => {
    __resetSsmCacheForTests();
  });

  afterEach(() => {
    if (originalVenmo === undefined) delete process.env.BIB_VENMO_HANDLE;
    else process.env.BIB_VENMO_HANDLE = originalVenmo;
    if (originalCashApp === undefined) delete process.env.BIB_CASHAPP_HANDLE;
    else process.env.BIB_CASHAPP_HANDLE = originalCashApp;
    vi.resetModules();
  });

  it("returns env BIB_VENMO_HANDLE when set (no SSM hop)", async () => {
    process.env.BIB_VENMO_HANDLE = "@override-venmo";
    const { getVenmoHandle } = await import("@/lib/handles");
    await expect(getVenmoHandle()).resolves.toBe("@override-venmo");
  });

  it("returns env BIB_CASHAPP_HANDLE when set (no SSM hop)", async () => {
    process.env.BIB_CASHAPP_HANDLE = "$override-cashapp";
    const { getCashAppHandle } = await import("@/lib/handles");
    await expect(getCashAppHandle()).resolves.toBe("$override-cashapp");
  });
});

describe("getVenmoHandle() + getCashAppHandle() — SSM fail-open default", () => {
  const originalVenmo = process.env.BIB_VENMO_HANDLE;
  const originalCashApp = process.env.BIB_CASHAPP_HANDLE;

  beforeEach(() => {
    delete process.env.BIB_VENMO_HANDLE;
    delete process.env.BIB_CASHAPP_HANDLE;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalVenmo === undefined) delete process.env.BIB_VENMO_HANDLE;
    else process.env.BIB_VENMO_HANDLE = originalVenmo;
    if (originalCashApp === undefined) delete process.env.BIB_CASHAPP_HANDLE;
    else process.env.BIB_CASHAPP_HANDLE = originalCashApp;
    vi.doUnmock("@/lib/ssm");
    vi.resetModules();
  });

  it("falls back to VENMO_HANDLE_DEFAULT when SSM throws", async () => {
    vi.doMock("@/lib/ssm", () => ({
      getSecureParam: vi
        .fn()
        .mockRejectedValue(new Error("SSM AccessDenied (test)")),
      __resetSsmCacheForTests: () => {},
    }));
    const { getVenmoHandle, VENMO_HANDLE_DEFAULT } = await import(
      "@/lib/handles"
    );
    await expect(getVenmoHandle()).resolves.toBe(VENMO_HANDLE_DEFAULT);
  });

  it("falls back to CASHAPP_HANDLE_DEFAULT when SSM throws", async () => {
    vi.doMock("@/lib/ssm", () => ({
      getSecureParam: vi
        .fn()
        .mockRejectedValue(new Error("SSM ParameterNotFound (test)")),
      __resetSsmCacheForTests: () => {},
    }));
    const { getCashAppHandle, CASHAPP_HANDLE_DEFAULT } = await import(
      "@/lib/handles"
    );
    await expect(getCashAppHandle()).resolves.toBe(CASHAPP_HANDLE_DEFAULT);
  });

  it("returns SSM value when available", async () => {
    vi.doMock("@/lib/ssm", () => ({
      getSecureParam: vi.fn().mockResolvedValue("@ssm-configured"),
      __resetSsmCacheForTests: () => {},
    }));
    const { getVenmoHandle } = await import("@/lib/handles");
    await expect(getVenmoHandle()).resolves.toBe("@ssm-configured");
  });
});
