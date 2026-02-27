import type { Provider } from "next-auth/providers";

import NextAuth, { type DefaultSession } from "next-auth";
import { dynamodbAdapter } from "@/entities/client";
import { upsertRunUser } from "@/entities/run-user";
import { config } from "@/config";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      displayName?: string;
      services: string[];
      linkedProviders: string[];
      hasStrava: boolean;
      hasDiscord: boolean;
      hasGithub: boolean;
      sessionVersion: number;
      lastRefresh?: number;
    } & DefaultSession["user"];
  }
  interface User {
    services?: string[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    authUserId?: string; // The user ID from auth.defcon.run (for fetching claims)
    displayName?: string;
    services: string[];
    linkedProviders: string[];
    lastRefresh?: number;
    sessionVersion?: number; // For session invalidation
    invalidated?: boolean; // Set to true when session should be terminated
  }
}

import "@auth/core/jwt"; // Import the module augmentation

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
 */
async function fetchFreshClaims(userId: string): Promise<FreshClaimsResult> {
  const validateUrl = `${config.urls.privateAuthServer}/api/session/validate/user`;
  try {
    // Call the auth server's internal API to get fresh claims
    // This is a server-to-server call, so we pass the userId directly
    const response = await fetch(`${validateUrl}/${userId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Use a shared secret for server-to-server auth
        "X-Internal-Secret": config.auth.internalSecret,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[run.human] Failed to fetch claims:", response.status, "URL:", `${config.urls.publicAuthServer}/api/session/validate/user/${userId}`, "Response:", text);
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
    console.error("[run.human] Error fetching fresh claims:", error);
    return null;
  }
}

const providers: Provider[] = [
  {
    id: "run.defcon.run",
    name: config.siteDomain,
    type: "oidc",
    issuer: `${config.urls.publicAuthServer}/api/oidc`,
    // Set redirectProxyUrl at provider level to ensure callback URL includes region prefix
    redirectProxyUrl: config.urls.redirectProxy,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: `${config.urls.publicAuthServer}/api/oidc/auth`,
      params: {
        scope: "openid profile email services",
      },
    },
    token: {
      url: `${config.urls.publicAuthServer}/api/oidc/token`,
    },
    checks: ["state", "pkce", "nonce"],
    client: {
      token_endpoint_auth_method: "client_secret_post",
    },
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
      };
    },
  },
];

// Cookie options helper
const cookieOptions = (httpOnly: boolean, maxAge?: number) => ({
  ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
  path: "/",
  httpOnly,
  sameSite: "lax" as const,
  secure: config.auth.secureCookies,
  ...(maxAge ? { maxAge } : {}),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  trustHost: true,
  basePath: config.auth.basePath,
  redirectProxyUrl: config.urls.redirectProxy,
  session: {
    strategy: "jwt",
    maxAge: config.session.maxAge,
    updateAge: config.session.updateAge,
  },
  theme: {
    colorScheme: "dark",
  },
  secret: config.auth.jwtSecret,
  providers,
  adapter: dynamodbAdapter,
  pages: {
    signIn: "/",
    error: config.urls.errorPage,
  },
  callbacks: {
    signIn({ user, profile, account }) {
      return true;
    },

    async jwt({ token, account, profile, trigger, session, user }) {
      const now = Date.now();

      /**
       * Helper to check lockout and session version, returns null if session should be invalidated
       */
      const validateAndUpdateClaims = async (authUserId: string): Promise<boolean> => {
        const freshClaims = await fetchFreshClaims(authUserId);
        if (!freshClaims) {
          return true; // Network error - keep existing session
        }

        // Check if user is locked out
        if (freshClaims.lockedOut) {
          console.log(`[run.human] User ${authUserId} is locked out, invalidating session`);
          return false;
        }

        // Check if session version changed (user signed out elsewhere or admin invalidated)
        const tokenVersion = typeof token.sessionVersion === 'number' ? token.sessionVersion : 1;
        if (freshClaims.sessionVersion > tokenVersion) {
          console.log(`[run.human] Session version mismatch for ${authUserId}: token=${tokenVersion}, server=${freshClaims.sessionVersion}`);
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
        const authUserId = token.authUserId as string;
        if (authUserId) {
          const isValid = await validateAndUpdateClaims(authUserId);
          if (!isValid) {
            // Mark token as invalidated - session callback will handle logout
            token.invalidated = true;
            return token;
          }
        }
        token.lastRefresh = now;
      } else if (account && profile) {
        // Initial login - extract claims from OIDC profile
        const userId = (typeof user?.id === "string" && user.id)
          || (typeof token.sub === "string" && token.sub)
          || (typeof token.userId === "string" && token.userId);

        if (account.provider === "run.defcon.run") {
          token.name = profile.name as string;
          token.picture = profile.picture as string;
          token.services = (profile.services as string[]) ?? [];
          token.linkedProviders = (profile.linked_providers as string[]) ?? [];
          token.sessionVersion = (profile.session_version as number) ?? 1;
          token.lastRefresh = now;
          // Store the auth.defcon.run user ID (profile.sub) for fetching claims
          token.authUserId = profile.sub as string;

          if (userId) {
            token.userId = userId;

            // Create/update RunUser record after successful OIDC login
            try {
              const runUser = await upsertRunUser(userId);
              token.displayName = runUser?.displayName;
            } catch (err) {
              console.error("Failed to upsert RunUser:", err);
            }
          }
        }
      } else {
        // Token refresh - check if we should re-query for updated claims
        // If lastRefresh is not set (old token), treat it as needing immediate refresh
        const lastRefresh = (token.lastRefresh as number) || 0;
        const timeSinceRefresh = lastRefresh === 0 ? config.session.refreshInterval : (now - lastRefresh);

        if (timeSinceRefresh >= config.session.refreshInterval) {
          // Fetch fresh claims from auth.defcon.run using the auth user ID
          const authUserId = token.authUserId as string;
          if (authUserId) {
            const isValid = await validateAndUpdateClaims(authUserId);
            if (!isValid) {
              // Mark token as invalidated - session callback will handle logout
              token.invalidated = true;
              return token;
            }
          }
          token.lastRefresh = now;
        }
      }

      // Ensure services and linkedProviders are always set
      token.services = token.services ?? [];
      token.linkedProviders = token.linkedProviders ?? [];

      return token;
    },

    session({ session, token }) {
      // Check if token has been invalidated (user locked out or session revoked)
      if (token.invalidated) {
        // Throw error to invalidate the session - this will cause useSession to return unauthenticated
        throw new Error("Session invalidated");
      }

      const linkedProviders = (token.linkedProviders ?? []) as string[];
      session.user.id = (token.sub ?? token.userId) as string;
      session.user.email = token.email as string;
      session.user.displayName = token.displayName as string | undefined;
      session.user.services = (token.services ?? []) as string[];
      session.user.linkedProviders = linkedProviders;
      session.user.hasStrava = linkedProviders.includes("strava");
      session.user.hasDiscord = linkedProviders.includes("discord");
      session.user.hasGithub = linkedProviders.includes("github");
      session.user.sessionVersion = (token.sessionVersion as number) ?? 1;
      session.user.lastRefresh = token.lastRefresh as number | undefined;
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: config.cookies.session.name,
      options: cookieOptions(true),
    },
    csrfToken: {
      name: config.cookies.csrf.name,
      options: cookieOptions(false),
    },
    callbackUrl: {
      name: config.cookies.callback.name,
      options: cookieOptions(false),
    },
    state: {
      name: config.cookies.state.name,
      options: cookieOptions(true, config.cookies.state.maxAge),
    },
  },
});
