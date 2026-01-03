/**
 * Cookie-based Authentication Middleware
 *
 * Reads JWT token from httpOnly cookie and adds it to the request context
 * for Strapi's admin authentication to use.
 *
 * This allows us to avoid storing tokens in localStorage (XSS vulnerable)
 * while maintaining compatibility with Strapi's token-based auth.
 */
import type { Core } from '@strapi/strapi';

const COOKIE_NAME = 'strapi_admin_token';

export default (config: { enabled?: boolean }, { strapi }: { strapi: Core.Strapi }) => {
  const enabled = config.enabled !== false;

  return async (ctx: any, next: () => Promise<void>) => {
    if (!enabled) {
      return next();
    }

    // Only process admin API requests
    const isAdminRoute = ctx.url.startsWith('/admin') ||
      ctx.url.startsWith(`/${process.env.REGION_SHORT || 'use1'}/admin`);

    if (!isAdminRoute) {
      return next();
    }

    // Skip if Authorization header already present
    if (ctx.request.headers.authorization) {
      return next();
    }

    // Read token from httpOnly cookie
    const token = ctx.cookies.get(COOKIE_NAME);

    if (token) {
      // Add Authorization header for Strapi's auth to use
      ctx.request.headers.authorization = `Bearer ${token}`;
      strapi.log.debug(`[CookieAuth] Added token from cookie for ${ctx.url}`);
    }

    return next();
  };
};
