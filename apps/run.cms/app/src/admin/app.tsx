/**
 * Strapi Admin Panel Customization
 *
 * Auto-redirects to SSO login when session expires instead of showing
 * the internal Strapi login page. This provides a seamless re-authentication
 * experience for users.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any;
declare class Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void);
}
declare class URL {
  constructor(url: string);
  searchParams: { set(name: string, value: string): void };
  toString(): string;
}
declare const console: { log(...args: any[]): void };

// Check if we're in local development mode
const isLocalDev = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
};

// Get region from the URL path (e.g., /use1/admin -> use1)
// Returns null if no region prefix found (localhost without prefix)
const getRegionFromPath = (): string | null => {
  if (typeof window === 'undefined') return 'use1';
  const pathMatch = window.location.pathname.match(/^\/([a-z]{3}\d)\/admin/);
  if (pathMatch) return pathMatch[1];
  // On localhost without region prefix, return null (no prefix needed)
  if (isLocalDev()) return null;
  // Production fallback
  return 'use1';
};

// Check if we're on a login page and should redirect to SSO
const shouldRedirectToSSO = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  // Match login and register-admin pages (both with and without region prefix)
  // Belt-and-suspenders: nginx blocks register-admin, but redirect if it somehow gets through
  return path.includes('/admin/auth/login') || path.includes('/admin/auth/register-admin');
};

// Redirect to SSO login
const redirectToSSO = (): void => {
  if (typeof window === 'undefined') return;
  const region = getRegionFromPath();
  // On localhost, never use region prefix for SSO URLs (plugin doesn't know about regions)
  // In production, nginx rewrites /{region}/strapi-plugin-sso/* to /strapi-plugin-sso/*
  const ssoUrl = isLocalDev() ? '/strapi-plugin-sso/oidc' : (region ? `/${region}/strapi-plugin-sso/oidc` : '/strapi-plugin-sso/oidc');
  console.log('[SSO] Session expired, redirecting to SSO:', ssoUrl);
  window.location.href = ssoUrl;
};

// Get auth server OIDC URL for the current region
// NOTE: In browser context, we read from window to get SITE_DOMAIN if available
// Since this is client-side, we fall back to hardcoded defaults but allow override
const getAuthServerUrl = (): string => {
  // Default site domain - this runs in browser so we can't use process.env directly
  // The production code uses auth.{siteDomain} pattern
  const siteDomain = 'defcon.run'; // TODO: Could inject via Strapi config if needed
  const localAuthPort = '3002';

  if (typeof window === 'undefined') return `https://auth.${siteDomain}/use1/api/oidc`;
  const region = getRegionFromPath();
  // In local dev, use localhost auth server without region prefix
  if (!region) return `http://localhost:${localAuthPort}/api/oidc`;
  // Use public auth server URL in production (for browser redirect)
  return `https://auth.${siteDomain}/${region}/api/oidc`;
};

// Redirect to auth server's end_session endpoint for full logout
const redirectToOIDCLogout = (): void => {
  if (typeof window === 'undefined') return;
  const region = getRegionFromPath();
  const authServerUrl = getAuthServerUrl();

  // Build the end_session URL with post_logout_redirect_uri
  const endSessionUrl = new URL(`${authServerUrl}/session/end`);
  // On localhost without region, redirect to /admin; otherwise /{region}/admin
  const postLogoutRedirectUri = region
    ? `${window.location.origin}/${region}/admin`
    : `${window.location.origin}/admin`;
  endSessionUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

  console.log('[SSO] Logging out via OIDC end_session:', endSessionUrl.toString());
  window.location.href = endSessionUrl.toString();
};

// Redirect to SSO if we're on a native login/register route, hiding the page
// first to prevent the native form from flashing. Idempotent — only fires once.
let ssoRedirectTriggered = false;
const maybeRedirectToSSO = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (ssoRedirectTriggered) return true;
  if (!shouldRedirectToSSO()) return false;
  ssoRedirectTriggered = true;
  // Hide the page immediately to prevent native login form flash
  if (window.document?.documentElement) {
    window.document.documentElement.style.display = 'none';
  }
  // Redirect immediately — no delay
  redirectToSSO();
  return true;
};

// Fire on hard load / full reload (URL already on the login route).
maybeRedirectToSSO();

// Also fire on SPA client-side navigation to the login route. On a cold
// (incognito) visit, Strapi's admin SPA routes from /{region}/admin to
// /admin/auth/login WITHOUT a full page reload, so the module-load check above
// never sees the login path and the native form is shown. React Router drives
// those transitions through the History API, so patch pushState/replaceState
// (and listen for popstate) to re-check after every client-side navigation.
if (typeof window !== 'undefined' && !ssoRedirectTriggered) {
  const patchHistory = (method: 'pushState' | 'replaceState'): void => {
    const original = window.history[method];
    window.history[method] = function (...args: any[]) {
      const result = original.apply(this, args);
      maybeRedirectToSSO();
      return result;
    };
  };
  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('popstate', () => maybeRedirectToSSO());
}

export default {
  config: {
    // Customize the Strapi admin locales
    locales: ['en'],

    // Disable tutorials/onboarding
    tutorials: false,

    // Notifications configuration
    notifications: {
      releases: false,
    },
  },

  // Bootstrap function runs on admin panel load
  bootstrap() {
    if (typeof window === 'undefined') return;

    let isRedirecting = false;

    // Intercept fetch for 401 handling and logout interception
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      // If we're already redirecting, return a pending promise (never resolves)
      if (isRedirecting) {
        return new Promise(() => {});
      }

      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      const method = typeof args[0] === 'string'
        ? (args[1] as any)?.method || 'GET'
        : (args[0] as Request).method;

      // Intercept logout requests - call Strapi logout first, then OIDC end_session
      if (url.includes('/admin/logout') && method.toUpperCase() === 'POST') {
        console.log('[SSO] Intercepting logout, calling Strapi logout then OIDC end_session');
        isRedirecting = true;

        // Clear localStorage tokens
        window.localStorage.removeItem('jwtToken');
        window.localStorage.removeItem('STRAPI_ADMIN_AUTH_TOKEN');

        // First, let Strapi logout complete to invalidate server-side session
        try {
          await originalFetch(...args);
        } catch (e) {
          // Ignore errors - proceed with OIDC logout anyway
          console.log('[SSO] Strapi logout error (proceeding anyway):', e);
        }

        // Then redirect to auth server's end_session endpoint
        redirectToOIDCLogout();
        // Return a promise that never resolves - page is navigating away
        return new Promise(() => {});
      }

      const response = await originalFetch(...args);

      // If we get a 401 on an admin API call, redirect to SSO immediately
      if (response.status === 401) {
        if (url.includes('/admin/')) {
          console.log('[SSO] Got 401 on admin API, redirecting to SSO immediately');
          isRedirecting = true;
          // Clear stale localStorage tokens
          window.localStorage.removeItem('jwtToken');
          window.localStorage.removeItem('STRAPI_ADMIN_AUTH_TOKEN');
          // Redirect to SSO for re-authentication
          redirectToSSO();
          // Return a promise that never resolves - page is navigating away
          return new Promise(() => {});
        }
      }

      return response;
    };
  },
};
