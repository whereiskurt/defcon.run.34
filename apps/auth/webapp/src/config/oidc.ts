import Provider, { Configuration, errors, ClientMetadata } from "oidc-provider";
import { OIDCAdapter } from "../entities/oidc-adapter";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * Registered OIDC clients (relying parties)
 * Each client represents an application that can authenticate users via auth.defcon.run
 */
const clients: ClientMetadata[] = [
  // run.human webapp client
  {
    client_id:  process.env.OIDC_RUNHUMAN_CLIENT_ID!,
    client_secret: process.env.OIDC_RUNHUMAN_SECRET!,
    redirect_uris: [
      "https://run.defcon.run/api/auth/callback/run.defcon.run",
      "http://localhost:3000/api/auth/callback/run.defcon.run", // Local development
      "http://localhost:3001/api/auth/callback/run.defcon.run", // Local development
      "http://localhost:3002/api/auth/callback/run.defcon.run", // Local development
      "https://localhost/api/auth/callback/run.defcon.run", // Local development (https)
    ],
    post_logout_redirect_uris: [
      "https://human.defcon.run",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "https://localhost",
      "http://localhost",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile email services",
    token_endpoint_auth_method: "client_secret_post",
  },
];

const isDev = process.env.NODE_ENV !== "production";
// Note: Using /api/oidc path for Pages Router
const issuer = isDev
  ? "http://localhost:3002/api/oidc"  // Auth server runs on port 3002
  : "https://auth.defcon.run/api/oidc";

// Route prefix for all OIDC endpoints (must match Next.js pages router path)
const routePrefix = "/api/oidc";

/**
 * OIDC Provider Configuration
 * @see https://github.com/panva/node-oidc-provider/blob/main/docs/README.md
 */
const configuration: Configuration = {
  // Use our custom DynamoDB adapter
  adapter: OIDCAdapter,

  // Static client registration
  clients,

  // Route paths - prefixed with /api/oidc to match our Next.js pages router setup
  routes: {
    authorization: `${routePrefix}/auth`,
    backchannel_authentication: `${routePrefix}/backchannel`,
    code_verification: `${routePrefix}/device`,
    device_authorization: `${routePrefix}/device/auth`,
    end_session: `${routePrefix}/session/end`,
    introspection: `${routePrefix}/token/introspection`,
    jwks: `${routePrefix}/jwks`,
    pushed_authorization_request: `${routePrefix}/request`,
    registration: `${routePrefix}/reg`,
    revocation: `${routePrefix}/token/revocation`,
    token: `${routePrefix}/token`,
    userinfo: `${routePrefix}/me`,
  },

  // Claims available for tokens
  claims: {
    openid: ["sub"],
    profile: ["name", "picture", "updated_at"],
    email: ["email", "email_verified"],
    services: ["services"],
  },

  // Enabled features
  features: {
    // Disable dev interactions - we use Auth.js UI
    devInteractions: { enabled: false },

    // Enable refresh tokens
    revocation: { enabled: true },

    // Disable features we don't need yet
    resourceIndicators: { enabled: false },
    userinfo: { enabled: true },
    jwtUserinfo: { enabled: false },
  },

  // Cookie configuration
  cookies: {
    keys: process.env.OIDC_COOKIE_KEYS?.split(",") || ["oidc-dev-key-change-me"],
    short: {
      signed: true,
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      ...(isDev ? {} : { secure: true, domain: ".defcon.run" }),
    },
    long: {
      signed: true,
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      ...(isDev ? {} : { secure: true, domain: ".defcon.run" }),
    },
  },

  // Token Time-To-Live configuration
  ttl: {
    AccessToken: 60 * 60, // 1 hour
    AuthorizationCode: 10 * 60, // 10 minutes
    IdToken: 60 * 60, // 1 hour
    RefreshToken: 14 * 24 * 60 * 60, // 14 days
    Interaction: 60 * 60, // 1 hour for login flow
    Session: 15 * 24 * 60 * 60, // 15 days (matches Auth.js session)
    Grant: 14 * 24 * 60 * 60, // 14 days
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
      return `/login?oidc=${interaction.uid}`;
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
          }
        }

        return result;
      },
    };
  },

  /**
   * Custom error rendering
   */
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
    <a href="/login">Try Again</a>
  </div>
</body>
</html>`;
  },

  // PKCE configuration
  pkce: {
    required: () => false, // Set to true for stricter security
  },

  // Rotate refresh tokens on use
  rotateRefreshToken: true,

  // Extra access token claims
  extraTokenClaims: async (ctx, token) => {
    return {};
  },
};

// Create the OIDC provider instance
export const oidc = new Provider(issuer, configuration);

// Re-export errors for use in route handlers
export { errors as OIDCErrors };

/**
 * Helper to check if an error is an OIDC session not found error
 */
export function isSessionNotFound(error: unknown): boolean {
  return error instanceof errors.SessionNotFound;
}
