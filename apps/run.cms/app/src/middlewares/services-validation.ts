/**
 * Services Claim Validation Middleware
 *
 * Periodically validates that the authenticated admin user still has
 * the 'cms' service in their auth profile. This provides immediate
 * revocation capability when an admin removes a user's CMS access.
 *
 * Works in conjunction with short session lifespans (5-10 min) which
 * force periodic OIDC re-auth. This middleware adds an extra layer
 * of validation for API requests between OIDC refreshes.
 */
import type { Core, UID } from '@strapi/strapi';

interface ValidationCacheEntry {
  validatedAt: number;
  services: string[];
}

// In-memory cache for validation timestamps per user email
// Key: user email, Value: last validation timestamp and services
const validationCache = new Map<string, ValidationCacheEntry>();

// How often to re-validate services claim (in milliseconds)
// Default: 5 minutes - aligns with access token lifespan
const VALIDATION_INTERVAL_MS = 5 * 60 * 1000;

// Required service for CMS access
const REQUIRED_SERVICE = process.env.OIDC_REQUIRED_SERVICES || 'cms';

// Auth server base URL for internal API calls
// Use service discovery name in production for direct VPC routing
// Service discovery points to run-auth-app container on port 3000 (HTTP)
// In production, run.auth has basePath=/{region}, so include it in the URL
const region = process.env.REGION_SHORT || 'use1';
const AUTH_SERVER_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3002'
  : `http://run-auth.app-${region}-defcon-run.local:3000/${region}`;

// Internal secret for server-to-server calls (matches auth server's AUTH_INTERNAL_SECRET)
const AUTH_INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Validate a user's services claim against the auth server
 */
async function validateUserServices(
  strapi: Core.Strapi,
  userEmail: string
): Promise<{ valid: boolean; services: string[] }> {
  try {
    // Check cache first
    const cached = validationCache.get(userEmail);
    const now = Date.now();

    if (cached && (now - cached.validatedAt) < VALIDATION_INTERVAL_MS) {
      // Cache is still fresh, check if services includes required service
      return {
        valid: cached.services.includes(REQUIRED_SERVICE),
        services: cached.services,
      };
    }

    // Cache miss or stale - validate against auth server
    // Use the internal user validation endpoint (supports both userId and email)
    const response = await fetch(
      `${AUTH_SERVER_URL}/api/session/validate/user/${encodeURIComponent(userEmail)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_INTERNAL_SECRET && { 'X-Internal-Secret': AUTH_INTERNAL_SECRET }),
        },
      }
    );

    if (!response.ok) {
      // If auth server is unreachable, use cached value if available
      // This prevents lockout during auth server maintenance
      if (cached) {
        strapi.log.warn(`[ServicesValidation] Auth server unavailable, using cached value for ${userEmail}`);
        return {
          valid: cached.services.includes(REQUIRED_SERVICE),
          services: cached.services,
        };
      }
      // No cache and auth server down - allow through but log warning
      strapi.log.warn(`[ServicesValidation] Auth server unavailable and no cache for ${userEmail}`);
      return { valid: true, services: [REQUIRED_SERVICE] };
    }

    const data = await response.json() as {
      valid?: boolean;
      user?: { services?: string[] };
      services?: string[];
    };
    // Auth server returns { valid: true, user: { services: [...] } }
    const services: string[] = data.user?.services || data.services || [];

    // Update cache
    validationCache.set(userEmail, {
      validatedAt: now,
      services,
    });

    const valid = services.includes(REQUIRED_SERVICE);
    if (!valid) {
      strapi.log.warn(`[ServicesValidation] User ${userEmail} no longer has '${REQUIRED_SERVICE}' service`);
    }

    return { valid, services };
  } catch (error) {
    strapi.log.error(`[ServicesValidation] Error validating services for ${userEmail}:`, error);

    // On error, check cache
    const cached = validationCache.get(userEmail);
    if (cached) {
      return {
        valid: cached.services.includes(REQUIRED_SERVICE),
        services: cached.services,
      };
    }

    // No cache - allow through to avoid lockout
    return { valid: true, services: [REQUIRED_SERVICE] };
  }
}

/**
 * Clear validation cache for a specific user
 * Call this when a user logs out or their permissions change
 */
export function clearValidationCache(userEmail?: string) {
  if (userEmail) {
    validationCache.delete(userEmail);
  } else {
    validationCache.clear();
  }
}

export default (config: { enabled?: boolean }, { strapi }: { strapi: Core.Strapi }) => {
  const enabled = config.enabled !== false;

  return async (ctx, next) => {
    if (!enabled) {
      return next();
    }

    // Only validate for admin API routes
    const isAdminRoute = ctx.url.startsWith('/admin') || ctx.url.startsWith(`/${process.env.REGION_SHORT || 'use1'}/admin`);
    if (!isAdminRoute) {
      return next();
    }

    // Skip validation for auth-related routes
    const authRoutes = ['/admin/login', '/admin/forgot-password', '/admin/reset-password', '/strapi-plugin-sso'];
    if (authRoutes.some(route => ctx.url.includes(route))) {
      return next();
    }

    // Get authenticated admin user
    const user = ctx.state?.user;
    if (!user?.email) {
      // Not authenticated - let Strapi handle it
      return next();
    }

    // Validate services claim
    const { valid, services } = await validateUserServices(strapi, user.email);

    if (!valid) {
      strapi.log.info(`[ServicesValidation] Blocking access for ${user.email} - missing '${REQUIRED_SERVICE}' service. Has: [${services.join(', ')}]`);

      // Clear any cached session data
      clearValidationCache(user.email);

      // Return 401 with clear message - admin panel will redirect to login
      ctx.status = 401;
      ctx.body = {
        error: 'Unauthorized',
        message: `Access denied. You no longer have the '${REQUIRED_SERVICE}' service permission.`,
      };
      return;
    }

    return next();
  };
};
