/**
 * Centralized configuration for run.human webapp
 * All environment variables and derived config values in one place
 */

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// Site domain from environment (defaults for local dev)
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";

// Local development ports (can be overridden via env vars)
const LOCAL_AUTH_PORT = process.env.LOCAL_AUTH_PORT || "3002";
const LOCAL_RUN_PORT = process.env.LOCAL_RUN_PORT || "3001";

// In development, allow self-signed certificates for OIDC provider
if (isDev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const config = {
  isDev,
  region,
  siteDomain,

  auth: {
    basePath: "/api/auth",
    jwtSecret: process.env.AUTH_JWT_SECRET?.split(","),
    internalSecret: process.env.AUTH_INTERNAL_SECRET || "",
    cookieDomain: isDev ? undefined : process.env.AUTH_COOKIE_DOMAIN,
    secureCookies: !isDev,
  },

  urls: {
    /** Public auth server URL (browser-accessible) */
    publicAuthServer: process.env.AUTH_PUBLIC_URL || (isDev
      ? `http://localhost:${LOCAL_AUTH_PORT}`
      : `https://auth.${siteDomain}/${region}`),

    /** Private auth server URL (internal network via service discovery) */
    // Service discovery points to run-auth-app container on port 3000 (HTTP)
    // In production, run.auth has basePath=/{region}, so include it in the URL
    privateAuthServer: process.env.AUTH_INTERNAL_URL || (isDev
      ? `http://localhost:${LOCAL_AUTH_PORT}`
      : `http://run-auth.app-${region}-${siteDomain.replace(/\./g, "-")}.local:3000/${region}`),

    /** Redirect proxy URL for OAuth callbacks */
    redirectProxy: process.env.RUN_PUBLIC_URL
      ? `${process.env.RUN_PUBLIC_URL}/api/auth`
      : (isDev
        ? `http://localhost:${LOCAL_RUN_PORT}/api/auth`
        : `https://run.${siteDomain}/${region}/api/auth`),

    /** Error page path */
    errorPage: isDev ? "/auth/error" : `/${region}/auth/error`,
  },

  session: {
    maxAge: 1 * 24 * 60 * 60, // 1 day in seconds
    updateAge: 60, // 1 minute - triggers JWT callback to refresh claims
    refreshInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
  },

  oidc: {
    clientId: process.env.OIDC_RUNHUMAN_CLIENT_ID || "run-human",
    clientSecret: process.env.OIDC_RUNHUMAN_SECRET!,
  },

  cms: {
    internalUrl: process.env.CMS_INTERNAL_URL || (isDev ? 'http://localhost:1337' : ''),
    apiToken: process.env.STRAPI_API_TOKEN || '',
  },

  cookies: {
    session: { name: "sess_run" },
    csrf: { name: "csrf_run" },
    callback: { name: "callback_run" },
    state: { name: "state_run", maxAge: 900 }, // 15 minutes
  },
} as const;

export type Config = typeof config;
