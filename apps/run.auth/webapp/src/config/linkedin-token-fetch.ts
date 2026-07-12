/**
 * LinkedIn OIDC token-exchange redirect_uri fix.
 *
 * This app runs under Next.js basePath `/${region}`, which strips the prefix
 * before Auth.js sees the request. Auth.js therefore computes the token-call
 * redirect_uri (provider.callbackUrl) WITHOUT the /{region} prefix. LinkedIn
 * strictly requires the token redirect_uri to byte-match the authorize one, so
 * the mismatch fails with invalid_redirect_uri.
 *
 * We rewrite it via the provider's [customFetch] on the token request only.
 * Kept dependency-free (no next-auth import) so it is unit-testable without
 * dragging the Next.js runtime into the test.
 */

/**
 * Mutate LinkedIn's token-exchange request body to carry the region-prefixed
 * redirect_uri. Only touches the token endpoint POST (`/oauth/v2/accessToken`)
 * whose body is a URLSearchParams; discovery/jwks/userinfo pass through.
 */
export function applyLinkedInTokenRedirectUri(
  href: string,
  body: unknown,
  redirectUri: string
): void {
  if (
    href.includes("/oauth/v2/accessToken") &&
    body != null &&
    typeof (body as URLSearchParams).set === "function"
  ) {
    (body as URLSearchParams).set("redirect_uri", redirectUri);
  }
}
