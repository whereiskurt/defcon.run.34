/**
 * Centralized configuration for run.auth webapp
 * All environment variables and derived config values in one place
 */

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// Site domain from environment (defaults for local dev)
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";

// Local development ports (can be overridden via env vars)
const LOCAL_AUTH_PORT = process.env.LOCAL_AUTH_PORT || "3002";

export const config = {
  isDev,
  region,
  siteDomain,

  auth: {
    basePath: "/api/auth",
    jwtSecret: process.env.AUTH_JWT_SECRET?.split(","),
    cookieDomain: isDev ? "localhost" : process.env.AUTH_COOKIE_DOMAIN,
    secureCookies: !isDev,
    allowedEmails: process.env.AUTH_ALLOWED_EMAILS?.split(","),
  },

  urls: {
    /** Base URL for the auth server (browser-accessible) */
    baseUrl: process.env.AUTH_PUBLIC_URL || (isDev
      ? `http://localhost:${LOCAL_AUTH_PORT}`
      : `https://auth.${siteDomain}/${region}`),

    /** Login page path */
    loginPage: isDev ? "/login" : `/${region}/login`,

    /** Verify request page path */
    verifyPage: isDev ? "/login/verify" : `/${region}/login/verify`,

    /** Callback path for OAuth redirects */
    callbackPath: isDev ? "/" : `/${region}/`,
  },

  session: {
    maxAge: 15 * 24 * 60 * 60, // 15 days in seconds
    updateAge: 24 * 60 * 60, // 24 hours in seconds
  },

  oidc: {
    issuer: process.env.AUTH_PUBLIC_URL
      ? `${process.env.AUTH_PUBLIC_URL}/api/oidc`
      : (isDev
        ? `http://localhost:${LOCAL_AUTH_PORT}/api/oidc`
        : `https://auth.${siteDomain}/${region}/api/oidc`),

    routePrefix: isDev ? "/api/oidc" : `/${region}/api/oidc`,

    cookieKeys: process.env.OIDC_COOKIE_KEYS?.split(",") || ["oidc-dev-key-change-me"],

    clients: {
      runHuman: {
        clientId: process.env.OIDC_RUNHUMAN_CLIENT_ID!,
        clientSecret: process.env.OIDC_RUNHUMAN_SECRET!,
      },
      cmsStrapi: {
        clientId: process.env.OIDC_CMS_CLIENT_ID!,
        clientSecret: process.env.OIDC_CMS_SECRET!,
      },
      gpxStudio: {
        clientId: process.env.OIDC_GPXSTUDIO_CLIENT_ID!,
        clientSecret: process.env.OIDC_GPXSTUDIO_SECRET!,
      },
      flashTool: {
        clientId: process.env.OIDC_FLASH_CLIENT_ID!,
        clientSecret: process.env.OIDC_FLASH_SECRET!,
      },
      bib: {
        clientId: process.env.OIDC_BIB_CLIENT_ID!,
        clientSecret: process.env.OIDC_BIB_SECRET!,
      },
    },

    ttl: {
      accessToken: 60 * 60, // 1 hour
      authorizationCode: 10 * 60, // 10 minutes
      idToken: 60 * 60, // 1 hour
      refreshToken: 14 * 24 * 60 * 60, // 14 days
      interaction: 60 * 60, // 1 hour
      session: 15 * 24 * 60 * 60, // 15 days
      grant: 14 * 24 * 60 * 60, // 14 days
    },
  },

  providers: {
    github: {
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    },
    strava: {
      clientId: process.env.AUTH_STRAVA_CLIENT_ID,
      clientSecret: process.env.AUTH_STRAVA_CLIENT_SECRET,
    },
    discord: {
      clientId: process.env.AUTH_DISCORD_CLIENT_ID,
      clientSecret: process.env.AUTH_DISCORD_CLIENT_SECRET,
    },
  },

  dynamodb: {
    endpoint: process.env.AUTH_DYNAMODB_ENDPOINT,
    region: process.env.AUTH_DYNAMODB_REGION,
    tableName: process.env.AUTH_DYNAMODB_DBNAME,
    credentials: {
      accessKeyId: process.env.AUTH_DYNAMODB_ID!,
      secretAccessKey: process.env.AUTH_DYNAMODB_SECRET!,
    },
  },

  ses: {
    region: process.env.AUTH_SES_REGION || "us-east-1",
    from: process.env.AUTH_SES_SMTP_FROM,
    credentials: process.env.AUTH_SES_ACCESS_KEY_ID && process.env.AUTH_SES_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AUTH_SES_ACCESS_KEY_ID,
          secretAccessKey: process.env.AUTH_SES_SECRET_ACCESS_KEY,
          sessionToken: process.env.AUTH_SES_SESSION_TOKEN,
        }
      : undefined,
  },

  cookies: {
    session: { name: "sess_auth" },
    csrf: { name: "csrf_auth" },
    callback: { name: "callback_auth" },
  },
} as const;

export type Config = typeof config;
