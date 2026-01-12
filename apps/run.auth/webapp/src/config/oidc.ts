import Provider, { Configuration, errors, ClientMetadata } from "oidc-provider";
import { OIDCAdapter } from "../entities/oidc-adapter";
import { getAuthProfile } from "@/entities/auth-profile";
import { config } from "@/config";

/**
 * Registered OIDC clients (relying parties)
 * Each client represents an application that can authenticate users via auth.defcon.run
 *
 * Redirect URIs include both regional prefixes (use1, cac1) to support multi-region deployments
 */
const clients: ClientMetadata[] = [
  // run.human webapp client
  {
    client_id: config.oidc.clients.runHuman.clientId,
    client_secret: config.oidc.clients.runHuman.clientSecret,
    redirect_uris: [
      // Production URLs - Auth.js doesn't include Next.js basePath in callback URLs
      // so we need both prefixed and non-prefixed versions
      "https://run.defcon.run/api/auth/callback/run.defcon.run",
      // Production regional URLs (kept for backwards compatibility)
      "https://run.defcon.run/use1/api/auth/callback/run.defcon.run",
      "https://run.defcon.run/cac1/api/auth/callback/run.defcon.run",

      "https://auth.defcon.run/use1/api/auth/callback/run.defcon.run",
      "https://auth.defcon.run/cac1/api/auth/callback/run.defcon.run",
      // Local development
      "http://localhost:3000/api/auth/callback/run.defcon.run",
      "http://localhost:3001/api/auth/callback/run.defcon.run",
      "http://localhost:3002/api/auth/callback/run.defcon.run",
      "https://localhost/api/auth/callback/run.defcon.run",
    ],
    post_logout_redirect_uris: [
      // Production regional URLs
      "https://run.defcon.run/use1",
      "https://run.defcon.run/cac1",
      // Local development
      "http://localhost:3001/",
      "http://localhost:3002",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile email services",
    token_endpoint_auth_method: "client_secret_post",
  },
  // CMS Strapi admin client (using strapi-plugin-sso)
  {
    client_id: config.oidc.clients.cmsStrapi.clientId,
    client_secret: config.oidc.clients.cmsStrapi.clientSecret,
    redirect_uris: [
      // Production URLs for strapi-plugin-sso callback (regional prefixes)
      "https://cms.defcon.run/use1/strapi-plugin-sso/oidc/callback",
      "https://cms.defcon.run/cac1/strapi-plugin-sso/oidc/callback",
      // Local development
      "http://localhost:1337/strapi-plugin-sso/oidc/callback",
      "http://localhost:1337/use1/strapi-plugin-sso/oidc/callback",
    ],
    post_logout_redirect_uris: [
      // Production regional URLs
      "https://cms.defcon.run/use1/admin",
      "https://cms.defcon.run/cac1/admin",
      // Local development
      "http://localhost:1337/admin",
      "http://localhost:1337/use1/admin",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile email services",
    token_endpoint_auth_method: "client_secret_post",
  },
  // GPX Studio client (gpx.defcon.run/{region})
  {
    client_id: config.oidc.clients.gpxStudio.clientId,
    client_secret: config.oidc.clients.gpxStudio.clientSecret,
    redirect_uris: [
      // Production URLs - both regions
      "https://gpx.defcon.run/use1/api/auth/callback/run.defcon.run",
      "https://gpx.defcon.run/cac1/api/auth/callback/run.defcon.run",
      // Local development
      "http://localhost:3003/use1/api/auth/callback/run.defcon.run",
    ],
    post_logout_redirect_uris: [
      // Production - both regions
      "https://gpx.defcon.run/use1",
      "https://gpx.defcon.run/cac1",
      // Local development
      "http://localhost:3003/use1",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile email services",
    token_endpoint_auth_method: "client_secret_post",
  },
];

/**
 * OIDC Provider Configuration
 * @see https://github.com/panva/node-oidc-provider/blob/main/docs/README.md
 */
const configuration: Configuration = {
  // Use our custom DynamoDB adapter
  adapter: OIDCAdapter,

  // Static client registration
  clients,

  // Route paths - must be full paths from host root (oidc-provider uses host + route for URLs)
  // In production: /{region}/api/oidc/auth, /{region}/api/oidc/token, etc.
  // In dev: /api/oidc/auth, /api/oidc/token, etc.
  routes: {
    authorization: `${config.oidc.routePrefix}/auth`,
    backchannel_authentication: `${config.oidc.routePrefix}/backchannel`,
    code_verification: `${config.oidc.routePrefix}/device`,
    device_authorization: `${config.oidc.routePrefix}/device/auth`,
    end_session: `${config.oidc.routePrefix}/session/end`,
    introspection: `${config.oidc.routePrefix}/token/introspection`,
    jwks: `${config.oidc.routePrefix}/jwks`,
    pushed_authorization_request: `${config.oidc.routePrefix}/request`,
    registration: `${config.oidc.routePrefix}/reg`,
    revocation: `${config.oidc.routePrefix}/token/revocation`,
    token: `${config.oidc.routePrefix}/token`,
    userinfo: `${config.oidc.routePrefix}/me`,
  },

  // Claims available for tokens
  // Note: By default claims go to userinfo. To include in ID token, we use conformIdTokenClaims: false
  claims: {
    openid: ["sub"],
    profile: ["name", "picture", "updated_at"],
    email: ["email", "email_verified"],
    services: ["services", "linked_providers", "mapboxPublicToken"],
  },

  // Include all requested claims in the ID token (not just userinfo)
  // This allows NextAuth to receive services and linked_providers directly
  conformIdTokenClaims: false,

  // Enabled features
  features: {
    // Disable dev interactions - we use Auth.js UI
    devInteractions: { enabled: false },

    // Enable refresh tokens
    revocation: { enabled: true },

    // Enable RP-initiated logout with auto-confirm (no confirmation page)
    rpInitiatedLogout: {
      enabled: true,
      logoutSource: async (ctx, form) => {
        // Auto-submit the logout form without user confirmation
        // The form contains the necessary CSRF token and logout parameters
        ctx.body = `<!DOCTYPE html>
<html>
<head><title>Logging out...</title></head>
<body onload="document.forms[0].submit()">
  ${form}
  <noscript>
    <p>JavaScript is required. Click the button to logout:</p>
    <button type="submit" form="op.logoutForm">Logout</button>
  </noscript>
</body>
</html>`;
      },
      postLogoutSuccessSource: async (ctx) => {
        // After OIDC logout succeeds, redirect to custom logout endpoint to clear Auth.js session
        // This avoids CSRF requirements of Auth.js's /api/auth/signout
        const paramValue = ctx.oidc.params?.post_logout_redirect_uri;
        const defaultRedirect = config.isDev ? 'http://localhost:3001' : `https://run.defcon.run/${config.region}`;
        const postLogoutRedirectUri = (typeof paramValue === 'string' ? paramValue : null) || defaultRedirect;

        // Redirect to our custom logout endpoint which clears sess_auth and redirects
        // URL must include region prefix for multi-region deployment
        const logoutPath = config.isDev ? "/api/logout" : `/${config.region}/api/logout`;
        const logoutUrl = `${logoutPath}?callbackUrl=${encodeURIComponent(postLogoutRedirectUri)}`;
        ctx.redirect(logoutUrl);
      },
    },

    // Disable features we don't need yet
    resourceIndicators: { enabled: false },
    userinfo: { enabled: true },
    jwtUserinfo: { enabled: false },
  },

  // Cookie configuration
  cookies: {
    keys: config.oidc.cookieKeys,
    short: {
      signed: true,
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      ...(config.isDev ? {} : { secure: true, domain: ".defcon.run" }),
    },
    long: {
      signed: true,
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      ...(config.isDev ? {} : { secure: true, domain: ".defcon.run" }),
    },
  },

  // Token Time-To-Live configuration
  ttl: {
    AccessToken: config.oidc.ttl.accessToken,
    AuthorizationCode: config.oidc.ttl.authorizationCode,
    IdToken: config.oidc.ttl.idToken,
    RefreshToken: config.oidc.ttl.refreshToken,
    Interaction: config.oidc.ttl.interaction,
    Session: config.oidc.ttl.session,
    Grant: config.oidc.ttl.grant,
  },

  /**
   * Interaction URL - where to redirect for login/consent
   * This is the critical integration point with Auth.js
   * When oidc-provider needs user authentication, it redirects here
   */
  interactions: {
    url(ctx, interaction) {
      // Redirect to the existing Auth.js login page with OIDC interaction ID
      // After login, /login will redirect to /api/oidc/interaction/{uid}
      return `${config.urls.loginPage}?oidc=${interaction.uid}`;
    },
  },

  /**
   * Find account by subject identifier
   * Called when oidc-provider needs user claims for tokens
   */
  async findAccount(ctx, sub) {
    // sub is the Auth.js user ID
    // Fetch the AuthProfile from DynamoDB for rich claims
    const profile = await getAuthProfile(sub);

    return {
      accountId: sub,
      async claims(use: string, scope: string, claims: Record<string, unknown>, rejected: string[]) {
        // sub is required by AccountClaims type
        const result: { sub: string; [key: string]: unknown } = { sub };


        if (profile) {
          // Profile claims (name, picture)
          if (scope.includes("profile")) {
            // Use cached name and picture, or fall back to provider-specific data
            result.name = profile.name
              || profile.discord?.globalName
              || profile.discord?.username
              || profile.github?.name
              || profile.github?.login
              || (profile.strava?.firstName
                ? `${profile.strava.firstName} ${profile.strava.lastName || ""}`.trim()
                : profile.strava?.username);

            result.picture = profile.picture
              || profile.discord?.avatarUrl
              || profile.github?.avatarUrl
              || profile.strava?.profileMedium;

            if (profile.updatedAt) {
              result.updated_at = Math.floor(profile.updatedAt / 1000);
            }
          }

          // Email claims
          if (scope.includes("email")) {
            result.email = profile.email
              || profile.discord?.email
              || profile.github?.email;
            result.email_verified = profile.emailVerified ?? (!!result.email);
          }

          // Services claims - list of services the user can access
          if (scope.includes("services")) {
            result.services = profile.services || [];

            const linkedProviders: string[] = [];
            if (profile.discord?.id) linkedProviders.push("discord");
            if (profile.github?.id) linkedProviders.push("github");
            if (profile.strava?.id) linkedProviders.push("strava");
            result.linked_providers = linkedProviders;

            // Mapbox public token for GPX Studio (user's personal token if set)
            if (profile.mapboxPublicToken) {
              result.mapboxPublicToken = profile.mapboxPublicToken;
            }
          }
        }

        return result;
      },
    };
  },

  renderError: async (ctx, out, error) => {
    console.error("OIDC Error:", error);
    ctx.type = "html";
    ctx.body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Error - DEFCON.run</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 400px;
    }
    h1 { color: #ef4444; margin-bottom: 1rem; }
    p { color: #a1a1aa; margin-bottom: 1.5rem; }
    a {
      color: #3b82f6;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border: 1px solid #3b82f6;
      border-radius: 0.5rem;
      display: inline-block;
    }
    a:hover { background: #3b82f6; color: #fff; }
    code {
      background: #1f1f1f;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authentication Error</h1>
    <p><code>${out.error}</code></p>
    <p>${out.error_description || "An error occurred during authentication."}</p>
    <a href="${config.urls.loginPage}">Try Again</a>
  </div>
</body>
</html>`;
  },

  pkce: {
    required: () => false,
  },

  rotateRefreshToken: true,

  // Extra access token claims
  extraTokenClaims: async (ctx, token) => {
    return {};
  },
};

// Create the OIDC provider instance
export const oidc = new Provider(config.oidc.issuer, configuration);

if (!config.isDev) {
  oidc.proxy = true;
}

// Debug event listeners to capture errors
// Note: oidc-provider only exposes certain typed events
oidc.on('grant.error', (ctx, error) => {
  console.error('[OIDC Event] grant.error:', error.message, error);
});

oidc.on('server_error', (ctx, error) => {
  console.error('[OIDC Event] server_error:', error.message, error);
});

// Re-export errors for use in route handlers
export { errors as OIDCErrors };

export function isSessionNotFound(error: unknown): boolean {
  return error instanceof errors.SessionNotFound;
}
