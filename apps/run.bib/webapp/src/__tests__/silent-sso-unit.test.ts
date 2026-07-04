import { describe, it, expect } from "vitest";
import {
  resolveSilentStatus,
  decideParentAction,
  resolveRegion,
  silentCallbackPath,
  SILENT_SSO_MESSAGE_TYPE,
  SILENT_SSO_TIMEOUT_MS,
} from "@/lib/silent-sso";

/**
 * Pure-logic unit tests for the silent-SSO decision helpers.
 *
 * Because the parity test guarantees the three copies (gpx/flash/bib) are
 * byte-identical, exercising run.bib's copy is equivalent to testing all three.
 * No DOM is needed — the logic lives in framework-agnostic pure functions.
 */

describe("resolveSilentStatus() — success is keyed on error ABSENCE, not a code param", () => {
  it("maps a param-less landing to success (next-auth already consumed the code at its own callback)", () => {
    // The real next-auth@5 success shape: it consumes `code` at
    // /api/auth/callback/<provider>, sets the session cookie, then redirects to
    // /silent-callback with NO error param.
    expect(resolveSilentStatus(new URLSearchParams(""))).toBe("success");
  });

  it("maps a landing carrying a benign, non-error param to success", () => {
    // A stray non-error param must NOT be misclassified as login_required.
    expect(resolveSilentStatus(new URLSearchParams("state=abc123"))).toBe(
      "success",
    );
  });

  it("does NOT key success on a `code` param — next-auth already consumed it", () => {
    // A bare `code` param is not a next-auth success signal here; the absence of
    // `error` is. It still resolves to success (because there is no error), which
    // confirms success is not gated on the presence of `code`.
    expect(resolveSilentStatus(new URLSearchParams("code=xyz"))).toBe("success");
  });

  it.each([
    ["error=login_required"],
    ["error=interaction_required"],
    ["error=consent_required"],
    ["error=access_denied"],
  ])(
    "maps the OIDC negative surfaced via next-auth's error param (%s) to login_required",
    (qs) => {
      expect(resolveSilentStatus(new URLSearchParams(qs))).toBe(
        "login_required",
      );
    },
  );

  it.each([
    // next-auth@5 surfaces every failure as ?error=<AuthErrorType>; the helper
    // keys on the presence of `error`, so ANY next-auth error code → login_required.
    ["error=AccessDenied"],
    ["error=Configuration"],
    ["error=Verification"],
  ])(
    "maps any next-auth@5 error param value (%s) to login_required",
    (qs) => {
      expect(resolveSilentStatus(new URLSearchParams(qs))).toBe(
        "login_required",
      );
    },
  );

  it.each([
    // Defensive: a raw OIDC negative arriving as its own bare key also normalizes.
    ["login_required"],
    ["interaction_required"],
    ["consent_required"],
    ["access_denied"],
  ])(
    "maps a raw OIDC negative arriving as a bare key (%s) to login_required",
    (qs) => {
      expect(resolveSilentStatus(new URLSearchParams(qs))).toBe(
        "login_required",
      );
    },
  );
});

describe("decideParentAction() — same-origin anti-spoofing gate", () => {
  const ORIGIN = "https://run.example.com";

  it("ignores a well-formed message from a FOREIGN origin (security invariant)", () => {
    const evt = {
      origin: "https://evil.example.com",
      data: { type: SILENT_SSO_MESSAGE_TYPE, status: "success" },
    };
    expect(decideParentAction(evt, ORIGIN)).toBe("ignore");
  });

  it("ignores a same-origin message whose type is not the silent-sso discriminator", () => {
    const evt = {
      origin: ORIGIN,
      data: { type: "some-other-type", status: "success" },
    };
    expect(decideParentAction(evt, ORIGIN)).toBe("ignore");
  });

  it("ignores same-origin non-object / null data", () => {
    expect(decideParentAction({ origin: ORIGIN, data: null }, ORIGIN)).toBe(
      "ignore",
    );
    expect(decideParentAction({ origin: ORIGIN, data: "hello" }, ORIGIN)).toBe(
      "ignore",
    );
  });

  it("maps a same-origin success message to authenticated", () => {
    const evt = {
      origin: ORIGIN,
      data: { type: SILENT_SSO_MESSAGE_TYPE, status: "success" },
    };
    expect(decideParentAction(evt, ORIGIN)).toBe("authenticated");
  });

  it("maps a same-origin login_required message to stay-logged-out", () => {
    const evt = {
      origin: ORIGIN,
      data: { type: SILENT_SSO_MESSAGE_TYPE, status: "login_required" },
    };
    expect(decideParentAction(evt, ORIGIN)).toBe("stay-logged-out");
  });
});

describe("SILENT_SSO_TIMEOUT_MS", () => {
  it("is a number within the ~4-5s target window (4000-5000ms inclusive)", () => {
    expect(typeof SILENT_SSO_TIMEOUT_MS).toBe("number");
    expect(SILENT_SSO_TIMEOUT_MS).toBeGreaterThanOrEqual(4000);
    expect(SILENT_SSO_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe("resolveRegion() — never empty (path -> cookie -> default)", () => {
  it("uses the region already in the path", () => {
    expect(resolveRegion("/use1/studio", "")).toBe("use1");
    expect(resolveRegion("/cac1/", "")).toBe("cac1");
  });

  it("path region wins over the cookie", () => {
    expect(resolveRegion("/use1/x", "preferred-region=cac1")).toBe("use1");
  });

  it("falls back to the preferred-region cookie when the path has no region", () => {
    expect(resolveRegion("/", "preferred-region=cac1")).toBe("cac1");
    expect(resolveRegion("/signin", "foo=bar; preferred-region=cac1")).toBe("cac1");
  });

  it("falls back to the default region (use1) when neither path nor cookie is valid", () => {
    expect(resolveRegion("/", "")).toBe("use1");
    expect(resolveRegion("/signin", "preferred-region=bogus")).toBe("use1");
    expect(resolveRegion("/api/auth/auto-signin", "")).toBe("use1");
  });

  it("NEVER returns an empty string (the region-less-URL regression guard)", () => {
    for (const [p, c] of [
      ["/", ""],
      ["/signin", ""],
      ["/silent-callback", "preferred-region="],
      ["/api/auth/auto-signin", "preferred-region=nope"],
    ] as const) {
      expect(resolveRegion(p, c)).not.toBe("");
    }
  });
});

describe("silentCallbackPath() — always region-prefixed", () => {
  it("prefixes with the resolved region, never bare /silent-callback", () => {
    expect(silentCallbackPath("/use1/x", "")).toBe("/use1/silent-callback");
    expect(silentCallbackPath("/", "preferred-region=cac1")).toBe("/cac1/silent-callback");
    expect(silentCallbackPath("/", "")).toBe("/use1/silent-callback");
  });
});
