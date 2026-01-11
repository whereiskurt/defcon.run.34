/**
 * Resolve the Mapbox token to use.
 * User's personal token takes precedence, falls back to default.
 */
export function resolveMapboxToken(userToken?: string): string {
  // User's personal token takes precedence
  if (userToken && userToken.startsWith("pk.")) {
    return userToken;
  }

  // Fall back to default token from environment
  const defaultToken = process.env.MAPBOX_DEFAULT_TOKEN;
  if (!defaultToken) {
    throw new Error("MAPBOX_DEFAULT_TOKEN not configured");
  }

  return defaultToken;
}

/**
 * Validate a Mapbox token format
 */
export function validateMapboxToken(token: string): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: false, error: "Token is required" };
  }

  if (token.startsWith("sk.")) {
    return {
      valid: false,
      error: "Secret tokens (sk.*) are not allowed. Use a public token (pk.*)",
    };
  }

  if (!token.startsWith("pk.")) {
    return {
      valid: false,
      error: "Invalid token format. Mapbox public tokens start with pk.",
    };
  }

  return { valid: true };
}
