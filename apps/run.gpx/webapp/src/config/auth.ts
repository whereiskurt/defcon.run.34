import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// Auth server URLs - must include region prefix in production
const authServerUrl = isDev
  ? "http://localhost:3002"
  : `https://auth.defcon.run/${region}`;
const oidcIssuer = isDev
  ? "http://localhost:3002/api/oidc"
  : `https://auth.defcon.run/${region}/api/oidc`;

// Redirect proxy URL for Auth.js callbacks
// This must match the actual auth endpoint path (including region prefix in prod)
const redirectProxyUrl = isDev
  ? "http://localhost:3003/api/auth"
  : `https://gpx.defcon.run/${region}/api/auth`;

export const authConfig: NextAuthConfig = {
  debug: false, // Disable verbose Auth.js debug logging (CREATE_STATE, authorization url, etc.)
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
    async jwt({ token, account, profile }) {
      if (account?.provider === "run.defcon.run" && profile) {
        // Extract services and mapboxPublicToken from OIDC claims
        // Ensure services is always an array (guard against malformed OIDC claims)
        const profileServices = (profile as { services?: string[] }).services;
        token.services = Array.isArray(profileServices) ? profileServices : [];
        token.mapboxPublicToken = (profile as { mapboxPublicToken?: string })
          .mapboxPublicToken;
        token.sub = profile.sub as string;
      }
      return token;
    },

    async session({ session, token }) {
      // Expose services and mapbox token to client
      // Ensure services is always an array
      const tokenServices = token.services as string[] | undefined;
      (session.user as { services?: string[] }).services =
        Array.isArray(tokenServices) ? tokenServices : [];
      (session.user as { mapboxPublicToken?: string }).mapboxPublicToken =
        token.mapboxPublicToken as string | undefined;
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  session: {
    strategy: "jwt",
    maxAge: 15 * 24 * 60 * 60, // 15 days
  },

  cookies: {
    sessionToken: {
      name: "sess_gpx",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
        ...(isDev ? {} : { domain: ".defcon.run" }),
      },
    },
    csrfToken: {
      name: "csrf_gpx",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
    callbackUrl: {
      name: "callback_gpx",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: !isDev,
      },
    },
    state: {
      name: "state_gpx",
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
