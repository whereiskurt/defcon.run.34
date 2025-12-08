import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { DynamoDB, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import type { Provider } from "next-auth/providers";

import NextAuth, { type DefaultSession } from "next-auth";
import { upsertRunUser } from "@/entities/run-user";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username?: string;
      services: string[];
      hasStrava: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    services?: string[];
    username?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    username?: string;
    services: string[];
    stravaId?: string;
  }
}

import "@auth/core/jwt"; // Import the module augmentation

// In development, allow self-signed certificates for OIDC provider
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const endpoint: string = process.env["RUN_DYNAMODB_ENDPOINT"]!;

const config: DynamoDBClientConfig = {
  credentials: {
    accessKeyId: process.env.RUN_DYNAMODB_ID!,
    secretAccessKey: process.env.RUN_DYNAMODB_SECRET!,
  },
  region: process.env.RUN_DYNAMODB_REGION,
  ...(endpoint ? { endpoint } : {}),
};
const client = DynamoDBDocument.from(new DynamoDB(config), {
  marshallOptions: {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
});
const adapter = DynamoDBAdapter(client, {
  tableName: process.env.RUN_DYNAMODB_DBNAME,
});

// OIDC provider for authentication via auth.defcon.run (or localhost in dev)
const isDev = process.env.NODE_ENV !== "production";
const authServerUrl = isDev
  ? "http://localhost:3002/api/oidc"  // Auth server runs on port 3002
  : "https://auth.defcon.run/api/oidc";

const providers: Provider[] = [
  {
    id: "run.defcon.run",
    name: "DEFCON.run",
    type: "oidc",
    issuer: authServerUrl,
    clientId: process.env.AUTH_OIDC_CLIENT_ID || "run-human",
    clientSecret: process.env.OIDC_RUNHUMAN_SECRET!,
    authorization: {
      params: {
        scope: "openid profile email services",
      },
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

const cookieDomain =
  process.env.NODE_ENV === "production" ? process.env.AUTH_COOKIE_DOMAIN  : "localhost";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 15 * 24 * 60 * 60, // 15 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
  theme: {
    colorScheme: "dark",
  },
  secret: process.env.AUTH_JWT_SECRET?.split(","),
  providers,
  adapter,
  pages: {
    signIn: "/",
  },
  callbacks: {
    signIn({ user, profile, account }) {
      return true;
    },

    async jwt({ token, account, profile, trigger, session, user }) {
      if (trigger === "update") {
        // token.theme = session.user.theme;
        // token.stravaId = session.user.hasStrava;
      } else if (account && profile) {
        // Get the user ID from the user object or token (ensure it's a string)
        const userId = (typeof user?.id === "string" && user.id)
          || (typeof token.sub === "string" && token.sub)
          || (typeof token.userId === "string" && token.userId);

        if (account.provider === "run.defcon.run") {
          token.name = profile.name as string;
          token.picture = profile.picture as string;
          token.services = (profile.services as string[]) ?? [];

          if (userId) {
            token.userId = userId;

            // Create/update RunUser record after successful OIDC login
            try {
              await upsertRunUser(userId, {
                services: token.services as string[],
              });
            } catch (err) {
              console.error("Failed to upsert RunUser:", err);
            }
          }
        }
      }

      // Ensure services is always set
      token.services = token.services ?? [];

      return token;
    },

    session({ session, token }) {
      session.user.id = (token.sub ?? token.userId) as string;
      session.user.email = token.email as string;
      session.user.username = token.username as string | undefined;
      session.user.services = (token.services ?? []) as string[];
      session.user.hasStrava = !!token.stravaId;
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: "sess_run",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
      },
    },
    csrfToken: {
      name: "csrf_run",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: true,
      },
    },
    callbackUrl: {
      name: "callback_run",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: true,
      },
    },
  },
});