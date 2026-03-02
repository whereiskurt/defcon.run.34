/**
 * Extension for strapi-plugin-sso
 * Adds service claim validation for OIDC authentication
 *
 * Users must have 'cms' in their services claim to access the CMS admin
 *
 * Security:
 * - Refresh token stored in httpOnly cookie (protected from XSS)
 * - Access token stored in localStorage (required for Strapi SPA, short-lived 5 min)
 */
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type { Core } from '@strapi/strapi';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderBrandedError(title: string, message: string, actions: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - defcon.run CMS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=MuseoModerno:wght@400;700&display=swap" rel="stylesheet">
  <style>
    /* EXACT values from auth.defcon.run - see globals.css and tailwind.config.js */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e4e4e7; font-family: 'MuseoModerno', 'Segoe UI', system-ui, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .container { position: relative; z-index: 2; text-align: center; padding: 2rem; max-width: 420px; width: 100%; animation: fadeUp 0.6s ease-out forwards; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .wordmark h1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.025em; }
    .teal-dot { color: #00d4aa; }
    .subtitle { font-family: monospace; font-size: 0.75rem; color: #71717a; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 0.5rem; }
    .glass-card { background: rgba(17, 17, 24, 0.8); backdrop-filter: blur(12px); border: 1px solid #2a2a3a; border-radius: 12px; padding: 2rem; margin-top: 2rem; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .glass-card:hover { border-color: #3a3a4a; box-shadow: 0 0 24px rgba(0, 212, 170, 0.06); }
    .error-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; color: #fbbf24; }
    .error-message { font-size: 0.9rem; color: #a1a1aa; line-height: 1.6; margin-bottom: 1.5rem; }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #00d4aa; color: #0a0a0f; font-family: 'MuseoModerno', sans-serif; font-size: 0.9rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; transition: background 0.2s ease; }
    .btn:hover { background: #00e8bb; }
    .btn-secondary { background: transparent; color: #a1a1aa; border: 1px solid #2a2a3a; margin-left: 0.5rem; }
    .btn-secondary:hover { border-color: #3a3a4a; color: #e4e4e7; background: rgba(17, 17, 24, 0.5); }
    .actions { display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap; }
  </style>
</head>
<body>
  <div class="container">
    <div class="wordmark">
      <h1>defcon<span class="teal-dot">.</span>run</h1>
      <p class="subtitle">Content Management System</p>
    </div>
    <div class="glass-card">
      <h2 class="error-title">${escapeHtml(title)}</h2>
      <p class="error-message">${escapeHtml(message)}</p>
      <div class="actions">${actions}</div>
    </div>
  </div>
</body>
</html>`;
}

const REQUIRED_SERVICE = process.env.OIDC_REQUIRED_SERVICES || 'cms';

// Refresh token cookie - httpOnly to protect from XSS
// Note: secure: false because TLS terminates at nginx/ALB, not Strapi
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: false, // Strapi behind reverse proxy - TLS terminates at edge
  sameSite: 'lax' as const,
  path: '/',
  // Refresh token cookie expires in 10 minutes (matches session config)
  maxAge: 10 * 60 * 1000,
};

/**
 * Generate secure tokens using Strapi's sessionManager with httpOnly cookies
 * This replaces the plugin's generateToken which uses non-httpOnly cookies
 */
async function generateSecureToken(
  strapi: Core.Strapi,
  user: { id: number | string },
  ctx: any
): Promise<string> {
  const sessionManager = (strapi as any).sessionManager;
  if (!sessionManager) {
    throw new Error('sessionManager is not supported. Please upgrade to Strapi v5.24.1 or later.');
  }

  const userId = String(user.id);
  const deviceId = randomUUID();

  // Generate refresh token and set as httpOnly cookie
  const { token: refreshToken } = await sessionManager('admin').generateRefreshToken(
    userId,
    deviceId,
    { type: 'refresh' }
  );

  ctx.cookies.set('strapi_admin_refresh', refreshToken, REFRESH_COOKIE_OPTIONS);

  // Generate access token from refresh token
  const accessResult = await sessionManager('admin').generateAccessToken(refreshToken);
  if ('error' in accessResult) {
    throw new Error(accessResult.error);
  }

  return accessResult.token;
}

export default (plugin) => {
  // Override the OIDC callback to add service claim validation
  plugin.controllers.oidc.oidcSignInCallback = async (ctx) => {
    const strapiInstance = (global as any).strapi as Core.Strapi;
    const config = strapiInstance.config.get('plugin::strapi-plugin-sso') as Record<string, any>;
    const httpClient = axios.create();
    const userService = strapiInstance.service('admin::user');
    const oauthService = strapiInstance.plugin('strapi-plugin-sso').service('oauth');
    const roleService = strapiInstance.plugin('strapi-plugin-sso').service('role');

    if (!ctx.query.code) {
      return ctx.send(renderBrandedError(
        'Authentication Failed',
        'Authorization code was not received from the identity provider. Please try signing in again.',
        '<a href="/" class="btn">Try Again</a>'
      ));
    }

    if (!ctx.query.state || ctx.query.state !== ctx.session.oidcState) {
      return ctx.send(renderBrandedError(
        'Authentication Failed',
        'The login session has expired or was invalid. Please try signing in again.',
        '<a href="/" class="btn">Try Again</a>'
      ));
    }

    const params = new URLSearchParams();
    params.append('code', ctx.query.code as string);
    params.append('client_id', config['OIDC_CLIENT_ID']);
    params.append('client_secret', config['OIDC_CLIENT_SECRET']);
    params.append('redirect_uri', config['OIDC_REDIRECT_URI']);
    params.append('grant_type', config['OIDC_GRANT_TYPE']);
    params.append('code_verifier', ctx.session.codeVerifier);

    try {
      // Exchange code for tokens
      const response = await httpClient.post(config['OIDC_TOKEN_ENDPOINT'], params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      // Fetch user info with Authorization header
      const userInfoEndpoint = config['OIDC_USER_INFO_ENDPOINT'];
      const userResponse = await httpClient.get(userInfoEndpoint, {
        headers: { Authorization: `Bearer ${response.data.access_token}` },
      });

      const userData = userResponse.data;
      strapiInstance.log.info(`[SSO] User info received: ${JSON.stringify(userData)}`);

      // Validate service claim
      const services: string[] = userData.services || [];
      if (!services.includes(REQUIRED_SERVICE)) {
        strapiInstance.log.warn(`[SSO] User ${userData.email} denied - missing '${REQUIRED_SERVICE}' service claim. Has: [${services.join(', ')}]`);
        return ctx.send(renderBrandedError(
          'Access Denied',
          "You don't have permission to access the CMS. Contact an event organizer to request access.",
          '<a href="/" class="btn">Back to Login</a>'
        ));
      }

      const email = userData.email;
      if (!email) {
        return ctx.send(renderBrandedError(
          'Authentication Failed',
          'Your identity provider did not share your email address, which is required to access the CMS.',
          '<a href="/" class="btn">Try Again</a>'
        ));
      }

      // Check if user exists
      let dbUser = await userService.findOneByEmail(email);
      let activateUser;
      let jwtToken;

      if (dbUser) {
        // Existing user - generate token with httpOnly cookies
        activateUser = dbUser;
        jwtToken = await generateSecureToken(strapiInstance, dbUser, ctx);
        strapiInstance.log.info(`[SSO] Existing user logged in: ${email}`);
      } else {
        // New user - auto-provision with admin role
        strapiInstance.log.info(`[SSO] Creating new admin user: ${email}`);

        // Get OIDC roles or default to Super Admin (role id 1)
        const oidcRoles = await roleService.oidcRoles();
        let roles = [];

        if (oidcRoles && oidcRoles['roles'] && oidcRoles['roles'].length > 0) {
          roles = oidcRoles['roles'].map((role) => ({ id: role }));
        } else {
          // Default to Super Admin role if no OIDC roles configured
          roles = [{ id: 1 }];
        }

        // Parse name - try given_name/family_name first, fall back to splitting 'name'
        let firstName = userData[config['OIDC_GIVEN_NAME_FIELD']] || userData.given_name;
        let lastName = userData[config['OIDC_FAMILY_NAME_FIELD']] || userData.family_name;

        if (!firstName && userData.name) {
          const nameParts = userData.name.split(' ');
          firstName = nameParts[0] || 'User';
          lastName = nameParts.slice(1).join(' ') || '';
        }

        const defaultLocale = oauthService.localeFindByHeader(ctx.request.headers);

        activateUser = await oauthService.createUser(
          email,
          lastName || '',
          firstName || 'User',
          defaultLocale,
          roles
        );

        jwtToken = await generateSecureToken(strapiInstance, activateUser, ctx);
        await oauthService.triggerWebHook(activateUser);
        strapiInstance.log.info(`[SSO] New admin user created: ${email} with roles: ${JSON.stringify(roles)}`);
      }

      oauthService.triggerSignInSuccess(activateUser);

      // Set refresh token in httpOnly cookie (protected from XSS)
      // Note: refresh token is already set by generateSecureToken

      strapiInstance.log.info(`[SSO] Login successful for ${email}, redirecting to admin panel`);

      // Get the admin URL from config
      const adminUrl = strapiInstance.config.get('admin.url') || '/admin';

      // Return HTML that sets localStorage token (required for Strapi SPA)
      // then redirects to admin panel. The access token is short-lived (5 min)
      // so exposure risk is minimal. Refresh token stays in httpOnly cookie.
      const nonce = randomUUID();
      const html = `
<!DOCTYPE html>
<html>
<head><title>SSO Login</title></head>
<body>
<script nonce="${nonce}">
  localStorage.setItem('jwtToken', '"${jwtToken}"');
  localStorage.setItem('STRAPI_ADMIN_AUTH_TOKEN', '"${jwtToken}"');
  window.location.href = '${adminUrl}';
</script>
</body>
</html>`;
      ctx.set('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
      ctx.type = 'text/html';
      ctx.body = html;
    } catch (e) {
      strapiInstance.log.error(`[SSO] Authentication error: ${(e as Error).message}`, e);
      ctx.send(renderBrandedError(
        'Authentication Failed',
        'Something went wrong during sign-in. Please try again.',
        '<a href="/" class="btn">Try Again</a>'
      ));
    }
  };

  return plugin;
};
