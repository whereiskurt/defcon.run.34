import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: "run.defcon.run",
      name: "DEF CON",
      type: "oidc",
      issuer: isDev
        ? "http://localhost:3002/api/oidc"
        : `https://auth.defcon.run/${region}/api/oidc`,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid profile email services",
        },
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
      }
      return token;
    },

    async session({ session, token }) {
      // Expose services and mapbox token to client
      (session.user as { services?: string[] }).services =
        (token.services as string[]) ?? [];
      (session.user as { mapboxPublicToken?: string }).mapboxPublicToken =
        token.mapboxPublicToken as string | undefined;
      return session;
    },
  },

  pages: {
    signIn: "/api/auth/signin",
    error: "/api/auth/error",
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
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
