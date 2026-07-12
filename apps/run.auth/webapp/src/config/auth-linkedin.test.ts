import { describe, it, expect } from "vitest";
import { applyLinkedInTokenRedirectUri } from "./linkedin-token-fetch";

/**
 * Unit tests for the LinkedIn token-exchange redirect_uri rewrite.
 *
 * Auth.js sends the non-region-prefixed provider.callbackUrl on the token call
 * (Next.js basePath strips /{region} before Auth.js sees the request). LinkedIn
 * requires the token redirect_uri to byte-match the authorize one, so we rewrite
 * it to the region-prefixed value via [customFetch]. These tests lock the
 * scoping: mutate ONLY the token endpoint POST, leave everything else alone.
 */

const REGION_URI = "https://auth.defcon.run/use1/api/auth/callback/linkedin";
const TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";

describe("applyLinkedInTokenRedirectUri", () => {
  it("rewrites redirect_uri on the token endpoint POST body", () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "https://auth.defcon.run/api/auth/callback/linkedin", // non-prefixed (wrong)
    });

    applyLinkedInTokenRedirectUri(TOKEN_ENDPOINT, body, REGION_URI);

    expect(body.get("redirect_uri")).toBe(REGION_URI);
    // other params untouched
    expect(body.get("code")).toBe("abc");
  });

  it("leaves non-token LinkedIn requests untouched (jwks/userinfo/discovery)", () => {
    const jwks = "https://www.linkedin.com/oauth/openid/jwks";
    const body = new URLSearchParams({ redirect_uri: "unchanged" });

    applyLinkedInTokenRedirectUri(jwks, body, REGION_URI);

    expect(body.get("redirect_uri")).toBe("unchanged");
  });

  it("no-ops when there is no body (GET requests)", () => {
    expect(() =>
      applyLinkedInTokenRedirectUri(TOKEN_ENDPOINT, undefined, REGION_URI)
    ).not.toThrow();
  });

  it("no-ops when body is not a URLSearchParams (no .set)", () => {
    const body = { some: "object" };
    expect(() =>
      applyLinkedInTokenRedirectUri(TOKEN_ENDPOINT, body, REGION_URI)
    ).not.toThrow();
    expect((body as Record<string, unknown>).redirect_uri).toBeUndefined();
  });

  it("uses whatever region URI it is given (cac1 works the same as use1)", () => {
    const cac1Uri = "https://auth.defcon.run/cac1/api/auth/callback/linkedin";
    const body = new URLSearchParams({ redirect_uri: "x" });

    applyLinkedInTokenRedirectUri(TOKEN_ENDPOINT, body, cac1Uri);

    expect(body.get("redirect_uri")).toBe(cac1Uri);
  });
});
