import type { Provider } from "next-auth/providers";

import NextAuth, { type DefaultSession } from "next-auth";
import { dynamodbAdapter } from "@/entities/client";
import { upsertRunUser } from "@/entities/run-user";

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
  }
}

import "@auth/core/jwt"; // Import the module augmentation

const isDev = process.env.NODE_ENV !== "production";

// In development, allow self-signed certificates for OIDC provider
if (isDev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const REGION_SHORT = process.env.REGION_SHORT || "use1";

// Auth.js basePath - relative path for route matching (Next.js already strips its basePath)
// URL construction uses NEXTAUTH_URL which includes the region prefix
const authBasePath = "/api/auth";

// Auth server base URL (with region prefix) for OIDC and session validation
const publicAuthServerUrl = isDev
  ? "http://localhost:3002"
  : `https://auth.defcon.run/${REGION_SHORT}`;

const privateAuthServerUrl = isDev
  ? "http://localhost:3002"
  : `https://auth.app-${REGION_SHORT}-defcon-run.local`;

const privateValidateUserUrl = `${privateAuthServerUrl}/api/session/validate/user`

// Auth.js redirectProxyUrl forces the callback URL to include the region prefix
// This is needed for CloudFront to route the callback to the correct regional backend
const redirectProxyUrl = isDev
  ? `http://localhost:3001${authBasePath}`
  : `https://run.defcon.run/${REGION_SHORT}${authBasePath}`;

// Cookie domain: in production use the configured domain, in dev omit to use current origin
// Setting domain to "localhost" explicitly can cause issues in some browsers
const cookieDomain = isDev ? undefined : process.env.AUTH_COOKIE_DOMAIN;

const useSecureCookies = !isDev;

/**
 * Fetch fresh claims from auth.defcon.run session validate endpoint
 */
async function fetchFreshClaims(userId: string): Promise<{
  services: string[];
  linkedProviders: string[];
} | null> {
  try {
    // Call the auth server's internal API to get fresh claims
    // This is a server-to-server call, so we pass the userId directly
    const response = await fetch(`${privateValidateUserUrl}/${userId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Use a shared secret for server-to-server auth
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[run.human] Failed to fetch claims:", response.status, "URL:", `${publicAuthServerUrl}/api/session/validate/user/${userId}`, "Response:", text);
      return null;
    }

    const data = await response.json();
    if (data.valid && data.user) {
      return {
        services: data.user.services || [],
        linkedProviders: data.user.linkedProviders || [],
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
    name: "DEFCON.run",
    type: "oidc",
    issuer: `${publicAuthServerUrl}/api/oidc`,
    // Set redirectProxyUrl at provider level to ensure callback URL includes region prefix
    redirectProxyUrl: redirectProxyUrl,
    clientId: process.env.OIDC_RUNHUMAN_CLIENT_ID || "run-human",
    clientSecret: process.env.OIDC_RUNHUMAN_SECRET!,
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: `${publicAuthServerUrl}/api/oidc/auth`,
      params: {
        scope: "openid profile email services",
      },
    },
    token: {
      url: `${publicAuthServerUrl}/api/oidc/token`,
    },
    checks: ["state"],
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

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  trustHost: true,
  basePath: authBasePath,
  // redirectProxyUrl forces callback URLs to include region prefix for CloudFront routing
  redirectProxyUrl,
  session: {
    strategy: "jwt",
    maxAge: 1 * 24 * 60 * 60, // 1 day in seconds
    updateAge: 60, // 1 minute - triggers JWT callback to refresh claims
  },
  theme: {
    colorScheme: "dark",
  },
  secret: process.env.AUTH_JWT_SECRET?.split(","),
  providers,
  adapter: dynamodbAdapter,
  pages: {
    signIn: "/",
    error: isDev ? "/auth/error" : `/${REGION_SHORT}/auth/error`,
  },
  callbacks: {
    signIn({ user, profile, account }) {
      return true;
    },

    async jwt({ token, account, profile, trigger, session, user }) {
      const now = Date.now();
      const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

      if (trigger === "update") {
        // Manual session update trigger - force refresh claims from auth server
        const authUserId = token.authUserId as string;
        if (authUserId) {
          const freshClaims = await fetchFreshClaims(authUserId);
          if (freshClaims) {
            token.services = freshClaims.services;
            token.linkedProviders = freshClaims.linkedProviders;
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
        const timeSinceRefresh = lastRefresh === 0 ? REFRESH_INTERVAL : (now - lastRefresh);

        if (timeSinceRefresh >= REFRESH_INTERVAL) {
          // Fetch fresh claims from auth.defcon.run using the auth user ID
          const authUserId = token.authUserId as string;
          if (authUserId) {
            const freshClaims = await fetchFreshClaims(authUserId);
            if (freshClaims) {
              token.services = freshClaims.services;
              token.linkedProviders = freshClaims.linkedProviders;
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
      const linkedProviders = (token.linkedProviders ?? []) as string[];
      session.user.id = (token.sub ?? token.userId) as string;
      session.user.email = token.email as string;
      session.user.displayName = token.displayName as string | undefined;
      session.user.services = (token.services ?? []) as string[];
      session.user.linkedProviders = linkedProviders;
      session.user.hasStrava = linkedProviders.includes("strava");
      session.user.hasDiscord = linkedProviders.includes("discord");
      session.user.hasGithub = linkedProviders.includes("github");
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: "sess_run",
      options: {
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: "csrf_run",
      options: {
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: "callback_run",
      options: {
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    state: {
      name: "state_run",
      options: {
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: useSecureCookies,
        maxAge: 900, // 15 minutes
      },
    },
  },
});