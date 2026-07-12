import { describe, it, expect } from "vitest";
import { isTestRequest } from "../lib/testmode.mjs";

const TOKEN = "s3cret-test-token-abc123";

describe("isTestRequest", () => {
  it("is OFF (false) when no token is configured — prod scans always log", () => {
    expect(isTestRequest({ "x-qr-test": TOKEN }, "")).toBe(false);
    expect(isTestRequest({ "x-qr-test": TOKEN }, undefined)).toBe(false);
    expect(isTestRequest({ "x-qr-test": TOKEN }, null)).toBe(false);
  });

  it("false when the header is absent or empty", () => {
    expect(isTestRequest({}, TOKEN)).toBe(false);
    expect(isTestRequest({ "x-qr-test": "" }, TOKEN)).toBe(false);
    expect(isTestRequest(undefined, TOKEN)).toBe(false);
  });

  it("false on a mismatch, including differing lengths", () => {
    expect(isTestRequest({ "x-qr-test": "wrong" }, TOKEN)).toBe(false);
    expect(isTestRequest({ "x-qr-test": TOKEN + "x" }, TOKEN)).toBe(false);
    expect(isTestRequest({ "x-qr-test": TOKEN.slice(0, -1) }, TOKEN)).toBe(false);
  });

  it("false when the header is not a string", () => {
    expect(isTestRequest({ "x-qr-test": 123 }, TOKEN)).toBe(false);
  });

  it("true only on an exact match", () => {
    expect(isTestRequest({ "x-qr-test": TOKEN }, TOKEN)).toBe(true);
  });
});
