import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// Auth server URLs
const authServerUrl = isDev
  ? "http://localhost:3002"
  : "https://auth.defcon.run";
const oidcIssuer = isDev
  ? "http://localhost:3002/api/oidc"
  : `https://auth.defcon.run/${region}/api/oidc`;

export const authConfig: NextAuthConfig = {
  debug: isDev,
  trustHost: true,

  providers: [
    {
      id: "run.defcon.run",
      name: "DEF CON",
      type: "oidc",
      issuer: oidcIssuer,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      authorization: {
        url: `${authServerUrl}/api/oidc/auth`,
        params: {
          scope: "openid profile email services",
        },
      },
      token: {
        url: `${authServerUrl}/api/oidc/token`,
      },
      checks: ["state"],
      client: {
        token_endpoint_auth_method: "client_secret_post",
      },
    },
  ],

  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "run.defcon.run" && profile) {
        // Extract services and mapboxPublicToken from OIDC claims
        token.services = (profile as { services?: string[] }).services ?? [];
        token.mapboxPublicToken = (profile as { mapboxPublicToken?: string })
          .mapboxPublicToken;
        token.sub = profile.sub as string;
      }
      return token;
    },

    async session({ session, token }) {
      // Expose services and mapbox token to client
      (session.user as { services?: string[] }).services =
        (token.services as string[]) ?? [];
      (session.user as { mapboxPublicToken?: string }).mapboxPublicToken =
        token.mapboxPublicToken as string | undefined;
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  // Don't specify custom pages - let Auth.js auto-redirect to OIDC provider

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

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
