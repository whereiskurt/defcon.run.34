import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { DynamoDB, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Provider } from "next-auth/providers";

import { createTransport } from "nodemailer";

import NextAuth, { type DefaultSession } from "next-auth";
import { upsertAuthProfile, getAuthProfile } from "@/entities/auth-profile";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      displayName?: string;
      services: string[];
      hasStrava: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    services?: string[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    displayName?: string;
    services: string[];
    stravaId?: string;
  }
}

import "@auth/core/jwt"; // Import the module augmentation
import Email from "@auth/core/providers/nodemailer";

import Discord from "next-auth/providers/discord";
import Github from "next-auth/providers/github";
import Strava from "next-auth/providers/strava";

const endpoint: string = process.env["AUTH_DYNAMODB_ENDPOINT"]!;

const config: DynamoDBClientConfig = {
  credentials: {
    accessKeyId: process.env.AUTH_DYNAMODB_ID!,
    secretAccessKey: process.env.AUTH_DYNAMODB_SECRET!,
  },
  region: process.env.AUTH_DYNAMODB_REGION,
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
  tableName: process.env.AUTH_DYNAMODB_DBNAME,
});

const sesClient = new SESv2Client({
  // Use explicit credentials if provided, otherwise fall back to default credential chain
  // (supports SSO, environment variables, ~/.aws/credentials, IAM roles, etc.)
  ...(process.env.AUTH_SES_ACCESS_KEY_ID && process.env.AUTH_SES_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AUTH_SES_ACCESS_KEY_ID,
          secretAccessKey: process.env.AUTH_SES_SECRET_ACCESS_KEY,
          ...(process.env.AUTH_SES_SESSION_TOKEN
            ? { sessionToken: process.env.AUTH_SES_SESSION_TOKEN }
            : {}),
        },
      }
    : {}),
  region: process.env.AUTH_SES_REGION || "us-east-1",
});

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";

// Base URL for constructing callback URLs - must include region prefix
const baseUrl = isDev
  ? "http://localhost:3002"
  : `https://auth.defcon.run/${REGION_SHORT}`;

const providers: Provider[] = [
  Email({
    server: {}, // Required by nodemailer provider, but unused since we use custom sendVerificationRequest
    from: process.env.AUTH_SES_SMTP_FROM,
    async sendVerificationRequest({
      identifier: email,
      url,
      provider: { from },
      theme,
    }) {
      const { host, searchParams: params } = new URL(url);

      const token = params.get("token")!;

      const transport = createTransport({
        SES: { sesClient, SendEmailCommand },
      });
      await transport.sendMail({
        from,
        to: email,
        subject: `${token}`, //this subject value enables click through on iOS!
        html: signupHTML({
          url,
          host,
          theme,
          email: email.replace("+", "%2B"),
          token,
        }),
        text: signupText({ url }),
      });
    },
    async generateVerificationToken() {
      const alphabet = "0123456789";
      return `${randomString(3, alphabet)}${randomString(3, alphabet)}`;
    },
  }),
  Github({
    clientId: process.env.AUTH_GITHUB_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET,
    allowDangerousEmailAccountLinking: true,
    checks: ["state"],
    authorization: {
      url: "https://github.com/login/oauth/authorize",
      params: {
        redirect_uri: `${baseUrl}/api/auth/callback/github`,
      },
    },
    token: {
      url: "https://github.com/login/oauth/access_token",
      params: {
        redirect_uri: `${baseUrl}/api/auth/callback/github`,
      },
    },
  }),
  Strava({
    clientId: process.env.AUTH_STRAVA_CLIENT_ID,
    clientSecret: process.env.AUTH_STRAVA_CLIENT_SECRET,
    allowDangerousEmailAccountLinking: true,
    checks: ["state"],
    authorization: {
      url: "https://www.strava.com/oauth/authorize",
      params: {
        scope: "activity:read",
        redirect_uri: `${baseUrl}/api/auth/callback/strava`,
      },
    },
    token: {
      url: "https://www.strava.com/oauth/token",
      params: {
        redirect_uri: `${baseUrl}/api/auth/callback/strava`,
      },
    },
  }),
  Discord({
    clientId: process.env.AUTH_DISCORD_CLIENT_ID,
    clientSecret: process.env.AUTH_DISCORD_CLIENT_SECRET,
    allowDangerousEmailAccountLinking: true,
    checks: ["state"],
    authorization: {
      url: "https://discord.com/api/oauth2/authorize",
      params: {
        scope: "identify email",
        redirect_uri: `${baseUrl}/api/auth/callback/discord`,
      },
    },
    token: {
      url: "https://discord.com/api/oauth2/token",
      params: {
        redirect_uri: `${baseUrl}/api/auth/callback/discord`,
      },
    },
  }),
];

const randomString = (length: number, alphabet: string): string =>
  Array.from(
    { length },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");

const cookieDomain =
  process.env.NODE_ENV === "production" ? process.env.AUTH_COOKIE_DOMAIN  : "localhost";

// In production behind a load balancer that terminates TLS, use secure cookies.
// The `trustHost: true` setting tells NextAuth to trust X-Forwarded-Proto headers.
const useSecureCookies = process.env.NODE_ENV === "production";

// Auth.js basePath - relative to the Next.js app root (Next.js basePath is already handled)
// This is used for matching incoming request paths after Next.js strips its basePath
const authBasePath = "/api/auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  trustHost: true,
  basePath: authBasePath,
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
    // Pages must include region prefix for multi-region deployment
    // Note: These are relative to the app, but Auth.js uses them for redirects
    signIn: isDev ? "/login" : `/${REGION_SHORT}/login`,
    verifyRequest: isDev ? "/login/verify" : `/${REGION_SHORT}/login/verify`,
  },
  callbacks: {
    signIn({ user, profile, account }) {
      const emails = process.env.AUTH_ALLOWED_EMAILS?.split(",");
      const email = user?.email ?? profile?.email!;
      //Strava is not a login provider, but rather linking.
      //NOTE: Strava has no email by design.
      if (
        account?.provider === "strava" ||
        !emails ||
        emails[0] === "" ||
        emails[0] === "all" ||
        emails?.includes(email)
      ) {
        return true;
      }

      console.log(
        `SECURITY: Blocked email address ${email!} from login ${JSON.stringify(
          emails
        )}.`
      );
      return false;
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

        if (account.provider === "discord") {
          token.name = `${profile.global_name}`;
          token.picture = `${profile.image_url}`;

          // Persist Discord profile to AuthProfile entity
          if (userId) {
            upsertAuthProfile(userId, "discord", {
              email: profile.email as string | undefined,
              discord: {
                id: String(profile.id),
                username: String(profile.username),
                globalName: profile.global_name as string | undefined,
                discriminator: profile.discriminator as string | undefined,
                avatarUrl: profile.image_url as string | undefined,
                email: profile.email as string | undefined,
              },
              // Store the full raw profile for later use
              discordProfile: profile as Record<string, unknown>,
            }).catch((err) => console.error("Failed to upsert Discord profile:", err));
          }
        } else if (account.provider === "github") {
          token.name = `${profile.login}`;
          token.picture = `${profile.avatar_url}`;

          // Persist GitHub profile to AuthProfile entity
          if (userId) {
            upsertAuthProfile(userId, "github", {
              email: profile.email as string | undefined,
              github: {
                id: Number(profile.id),
                login: String(profile.login),
                name: profile.name as string | undefined,
                avatarUrl: profile.avatar_url as string | undefined,
                email: profile.email as string | undefined,
              },
              // Store the full raw profile for later use
              githubProfile: profile as Record<string, unknown>,
            }).catch((err) => console.error("Failed to upsert GitHub profile:", err));
          }
        } else if (account.provider === "strava" && token.email != "") {
          token.name = `${profile.username}`;
          token.picture = `${profile.profile_medium}`;
          token.stravaId = `${profile.id}`;

          // Persist Strava profile to AuthProfile entity
          if (userId) {
            upsertAuthProfile(userId, "strava", {
              strava: {
                id: Number(profile.id),
                username: profile.username as string | undefined,
                firstName: profile.firstname as string | undefined,
                lastName: profile.lastname as string | undefined,
                profileMedium: profile.profile_medium as string | undefined,
                city: profile.city as string | undefined,
                state: profile.state as string | undefined,
                country: profile.country as string | undefined,
              },
              // Store the full raw profile for later use
              stravaProfile: profile as Record<string, unknown>,
            }).catch((err) => console.error("Failed to upsert Strava profile:", err));
          }
        }
      } else if (account && account.provider === "nodemailer") {
        // There is no ${profile} for nodemailer.
        // Persist email profile to AuthProfile entity
        const userId = (typeof user?.id === "string" && user.id)
          || (typeof token.sub === "string" && token.sub)
          || (typeof token.userId === "string" && token.userId);
        if (userId && token.email) {
          upsertAuthProfile(userId, "email", {
            email: token.email as string,
          }).catch((err) => console.error("Failed to upsert email profile:", err));
        }
      }

      // Fetch services and strava status from AuthProfile and store in token
      // This runs on every JWT refresh, so services will be updated
      const userId = (typeof user?.id === "string" && user.id)
        || (typeof token.sub === "string" && token.sub)
        || (typeof token.userId === "string" && token.userId);
      if (userId) {
        try {
          const profile = await getAuthProfile(userId);
          // Use profile services if available, otherwise keep existing token services or default to empty
          token.services = profile?.services ?? token.services ?? [];
          // Store the rabbit displayName in the token
          token.displayName = profile?.displayName ?? token.displayName;
          // Store stravaId if linked (check AuthProfile strava data)
          if (profile?.strava?.id) {
            token.stravaId = `${profile.strava.id}`;
          }
        } catch (err) {
          console.error("Failed to fetch services for token:", err);
          // Keep existing services on error
          token.services = token.services ?? [];
        }
      } else {
        token.services = token.services ?? [];
      }

      return token;
    },

    session({ session, token }) {
      session.user.id = (token.sub ?? token.userId) as string;
      session.user.email = token.email as string;
      session.user.displayName = token.displayName as string | undefined;
      session.user.name = session.user.displayName
      session.user.services = (token.services ?? []) as string[];
      session.user.hasStrava = !!token.stravaId;
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name: "sess_auth",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: "csrf_auth",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: "callback_auth",
      options: {
        domain: cookieDomain,
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
  },
});

export function signupHTML(params: {
  url: any;
  host: any;
  theme: any;
  email: string;
  token: string;
}) {
  const { host, theme, token, email } = params;
  // Construct callback URL with region prefix for multi-region deployment
  const callbackPath = isDev ? "/" : `/${REGION_SHORT}/`;
  const url = `${baseUrl}/api/auth/callback/nodemailer?token=${token}&email=${email}&callbackUrl=${encodeURIComponent(callbackPath)}`;
  const escapedHost = host.replace(/\./g, "&#8203;.");

  const brandColor = "#686EA0";
  const color = {
    background: "#f9f9f9",
    text: "#444",
    mainBackground: "#fff",
    buttonBackground: brandColor,
    buttonBorder: brandColor,
    buttonText: theme.buttonText || "#fff",
  };

  return `
  <body style="background: ${color.background};">
    <table width="100%" border="0" cellspacing="10" cellpadding="0"
      style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 10px;">
      <tr>
        <td align="center"
          style="padding: 0px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
          <strong>DEFCON.run</strong>
        </td>
      </tr>
      <tr>
        <td align="center"
          style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
          To complete your sign-in click:
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 0px 0;">
          <table border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td align="center" style="border-radius: 5px;" bgcolor="${color.buttonBackground}"><a href="${url}"
                  target="_blank"
                  style="font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.buttonText}; text-decoration: none; border-radius: 5px; padding: 10px 50px; border: 1px solid ${color.buttonBorder}; display: inline-block; font-weight: bold;">🚀 Sign-in</a></td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td align="center"
          style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
          <p>Or! Copy & paste this one time code into app:</p><p style="font-size: 22px;"><strong>${token}</strong></p>
        </td>
      </tr>

      <tr>
        <td align="center"
          style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
          If you did not request this email you can safely ignore it.
        </td>
      </tr>
    </table>
  </body>
  `;
}
export function signupText(params: { url: any }) {
  const { url } = params;
  return `Complete your sign in to DEFCON.run with this URL:\n${url}\n\n`;
}
