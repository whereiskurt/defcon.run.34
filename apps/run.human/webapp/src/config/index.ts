/**
 * Centralized configuration for run.human webapp
 * All environment variables and derived config values in one place
 */

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";

// In development, allow self-signed certificates for OIDC provider
if (isDev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const config = {
  isDev,
  region,

  auth: {
    basePath: "/api/auth",
    jwtSecret: process.env.AUTH_JWT_SECRET?.split(","),
    internalSecret: process.env.AUTH_INTERNAL_SECRET || "",
    cookieDomain: isDev ? undefined : process.env.AUTH_COOKIE_DOMAIN,
    secureCookies: !isDev,
  },

  urls: {
    /** Public auth server URL (browser-accessible) */
    publicAuthServer: isDev
      ? "http://localhost:3002"
      : `https://auth.defcon.run/${region}`,

    /** Private auth server URL (internal network) */
    privateAuthServer: isDev
      ? "http://localhost:3002"
      : `https://auth.app-${region}-defcon-run.local`,

    /** Redirect proxy URL for OAuth callbacks */
    redirectProxy: isDev
      ? "http://localhost:3001/api/auth"
      : `https://run.defcon.run/${region}/api/auth`,

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

  cookies: {
    session: { name: "sess_run" },
    csrf: { name: "csrf_run" },
    callback: { name: "callback_run" },
    state: { name: "state_run", maxAge: 900 }, // 15 minutes
  },
} as const;

export type Config = typeof config;
