import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// Site domain from environment (defaults for local dev)
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";

// Local development ports (can be overridden via env vars)
const LOCAL_AUTH_PORT = process.env.LOCAL_AUTH_PORT || "3002";
const LOCAL_FLASH_PORT = process.env.LOCAL_FLASH_PORT || "3004";

// Auth server URLs - must include region prefix in production
const authServerUrl = process.env.AUTH_PUBLIC_URL || (isDev
  ? `http://localhost:${LOCAL_AUTH_PORT}`
  : `https://auth.${siteDomain}/${region}`);
const oidcIssuer = process.env.AUTH_PUBLIC_URL
  ? `${process.env.AUTH_PUBLIC_URL}/api/oidc`
  : (isDev
    ? `http://localhost:${LOCAL_AUTH_PORT}/api/oidc`
    : `https://auth.${siteDomain}/${region}/api/oidc`);

// Internal auth server URL for server-to-server validation calls
// Uses service discovery in production (no TLS, direct container communication)
const internalAuthServerUrl = process.env.AUTH_INTERNAL_URL || (isDev
  ? `http://localhost:${LOCAL_AUTH_PORT}`
  : `http://run-auth.app-${region}-${siteDomain.replace(/\./g, "-")}.local:3000/${region}`);

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";

// Session configuration
const SESSION_MAX_AGE = 1 * 24 * 60 * 60; // 1 day (reduced from 15 days for security)
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Redirect proxy URL for Auth.js callbacks
// This must match the actual auth endpoint path (including region prefix in prod)
const redirectProxyUrl = process.env.FLASH_PUBLIC_URL
  ? `${process.env.FLASH_PUBLIC_URL}/api/auth`
  : (isDev
    ? `http://localhost:${LOCAL_FLASH_PORT}/api/auth`
    : `https://flash.${siteDomain}/${region}/api/auth`);

/**
 * Result from fetching fresh claims from auth server
 */
type FreshClaimsResult = {
  services: string[];
  linkedProviders: string[];
  sessionVersion: number;
  lockedOut: boolean;
} | null;

/**
 * Fetch fresh claims from auth.defcon.run session validate endpoint
 * This allows us to detect revoked access, lockouts, and session invalidation
 */
export async function fetchFreshClaims(userId: string): Promise<FreshClaimsResult> {
  const validateUrl = `${internalAuthServerUrl}/api/session/validate/user`;
  try {
    const response = await fetch(`${validateUrl}/${userId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
    });

    if (!response.ok) {
      console.error(
        "[run.flash] Failed to fetch claims:",
        response.status,
        "URL:",
        `${validateUrl}/${userId}`
      );
      return null;
    }

    const data = await response.json();
    if (data.valid && data.user) {
      return {
        services: data.user.services || [],
        linkedProviders: data.user.linkedProviders || [],
        sessionVersion: data.user.sessionVersion ?? 1,
        lockedOut: data.user.lockedOut ?? false,
      };
    }
    return null;
  } catch (error) {
    console.error("[run.flash] Error fetching fresh claims:", error);
    return null;
  }
}

export const authConfig: NextAuthConfig = {
  debug: false, // Disable verbose Auth.js debug logging
  trustHost: true,

  // Suppress env-url-basepath-mismatch warning - expected in our setup
  // AUTH_URL includes region prefix (/use1), but basePath is just /api/auth
  // because Next.js strips the region prefix before Auth.js sees the request
  logger: {
    error: (code, ...message) => console.error(code, ...message),
    warn: (code, ...message) => {
      // Suppress known false-positive warning
      if (code === "env-url-basepath-mismatch") return;
      console.warn(code, ...message);
    },
    // Debug logging disabled - too noisy for normal development
  },

  // basePath is for internal routing AFTER Next.js strips its basePath (/use1)
  // Request flow: /use1/api/auth/session -> Next.js strips /use1 -> /api/auth/session
  // Auth.js needs basePath="/api/auth" to parse "session" as the action
  basePath: "/api/auth",

  // Use custom signin page that auto-redirects to OIDC provider
  // This avoids Auth.js generating incorrect URLs on the default signin page
  // Must include region prefix in production since Auth.js doesn't know about Next.js basePath
  pages: {
    signIn: isDev ? "/signin" : `/${region}/signin`,
    // Route NextAuth's default callback-error redirect to the silent-callback
    // bridge so a prompt=none negative is captured in-frame; the bridge falls
    // through to normal sign-in when loaded top-level.
    error: isDev ? "/silent-callback" : `/${region}/silent-callback`,
  },

  providers: [
    {
      id: "run.defcon.run",
      name: "DEF CON",
      type: "oidc",
      issuer: oidcIssuer,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      // redirectProxyUrl for callback URL construction
      redirectProxyUrl,
      authorization: {
        url: `${authServerUrl}/api/oidc/auth`,
        params: {
          scope: "openid profile email services",
        },
      },
      token: {
        url: `${authServerUrl}/api/oidc/token`,
      },
      checks: ["state", "pkce", "nonce"],
      client: {
        token_endpoint_auth_method: "client_secret_post",
      },
    },
  ],

  callbacks: {
    async jwt({ token, account, profile, trigger }) {
      const now = Date.now();

      /**
       * Validate claims against auth server and update token
       * Returns false if session should be invalidated (locked out or revoked)
       */
      const validateAndUpdateClaims = async (
        userId: string
      ): Promise<boolean> => {
        const freshClaims = await fetchFreshClaims(userId);
        if (!freshClaims) {
          return true; // Network error - keep existing session
        }

        // Check if user is locked out
        if (freshClaims.lockedOut) {
          console.log(
            `[run.flash] User ${userId} is locked out, invalidating session`
          );
          return false;
        }

        // Check if session version changed (user signed out elsewhere or admin invalidated)
        const tokenVersion =
          typeof token.sessionVersion === "number" ? token.sessionVersion : 1;
        if (freshClaims.sessionVersion > tokenVersion) {
          console.log(
            `[run.flash] Session version mismatch for ${userId}: token=${tokenVersion}, server=${freshClaims.sessionVersion}`
          );
          return false;
        }

        // Update token with fresh claims
        token.services = freshClaims.services;
        token.linkedProviders = freshClaims.linkedProviders;
        token.sessionVersion = freshClaims.sessionVersion;
        return true;
      };

      if (trigger === "update") {
        // Manual session update trigger - force refresh claims from auth server
        const userId = token.sub as string;
        if (userId) {
          const isValid = await validateAndUpdateClaims(userId);
          if (!isValid) {
            token.invalidated = true;
            return token;
          }
        }
        token.lastRefresh = now;
      } else if (account?.provider === "run.defcon.run" && profile) {
        // Initial login - extract claims from OIDC profile
        const profileServices = (profile as { services?: string[] }).services;
        token.services = Array.isArray(profileServices) ? profileServices : [];
        token.linkedProviders =
          (profile as { linked_providers?: string[] }).linked_providers ?? [];
        token.sub = profile.sub as string;
        token.sessionVersion = 1;
        token.lastRefresh = now;
      } else {
        // Token refresh - check if we should re-query for updated claims
        const lastRefresh = (token.lastRefresh as number) || 0;
        const timeSinceRefresh =
          lastRefresh === 0 ? REFRESH_INTERVAL : now - lastRefresh;

        if (timeSinceRefresh >= REFRESH_INTERVAL) {
          const userId = token.sub as string;
          if (userId) {
            const isValid = await validateAndUpdateClaims(userId);
            if (!isValid) {
              token.invalidated = true;
              return token;
            }
          }
          token.lastRefresh = now;
        }
      }

      // Ensure services is always set
      token.services = token.services ?? [];

      return token;
    },

    async session({ session, token }) {
      // Check if token has been invalidated (user locked out or session revoked)
      if (token.invalidated) {
        throw new Error("Session invalidated");
      }

      // Expose services to client
      const tokenServices = token.services as string[] | undefined;
      (session.user as { services?: string[] }).services = Array.isArray(
        tokenServices
      )
        ? tokenServices
        : [];
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
  },

  cookies: {
    sessionToken: {
      name: "sess_flash",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
        ...(isDev ? {} : { domain: `.${siteDomain}` }),
      },
    },
    csrfToken: {
      name: "csrf_flash",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
    callbackUrl: {
      name: "callback_flash",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
    state: {
      name: "state_flash",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
        maxAge: 900, // 15 minutes
      },
    },
  },
};

// Export with redirectProxyUrl and secret at the NextAuth level
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  redirectProxyUrl,
  // Secret for JWT encryption - uses AUTH_JWT_SECRET env var (supports rotation via comma-separated list)
  secret: process.env.AUTH_JWT_SECRET?.split(","),
});
