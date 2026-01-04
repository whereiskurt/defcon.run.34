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
      return ctx.send(oauthService.renderSignUpError('code Not Found'));
    }

    if (!ctx.query.state || ctx.query.state !== ctx.session.oidcState) {
      return ctx.send(oauthService.renderSignUpError('Invalid state'));
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
        return ctx.send(oauthService.renderSignUpError(
          `Access denied. You need the '${REQUIRED_SERVICE}' service permission to access this CMS.`
        ));
      }

      const email = userData.email;
      if (!email) {
        return ctx.send(oauthService.renderSignUpError('Email not provided by identity provider'));
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
      ctx.send(oauthService.renderSignUpError((e as Error).message));
    }
  };

  return plugin;
};
