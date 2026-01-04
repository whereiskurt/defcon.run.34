/**
 * Strapi Admin Panel Customization
 *
 * Auto-redirects to SSO login when session expires instead of showing
 * the internal Strapi login page. This provides a seamless re-authentication
 * experience for users.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any;
declare function setTimeout(callback: () => void, ms: number): void;
declare class Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void);
}
declare class URL {
  constructor(url: string);
  searchParams: { set(name: string, value: string): void };
  toString(): string;
}
declare const console: { log(...args: any[]): void };

// Get region from the URL path (e.g., /use1/admin -> use1)
const getRegionFromPath = (): string => {
  if (typeof window === 'undefined') return 'use1';
  const pathMatch = window.location.pathname.match(/^\/([a-z]{3}\d)\/admin/);
  return pathMatch ? pathMatch[1] : 'use1';
};

// Check if we're on a login page and should redirect to SSO
const shouldRedirectToSSO = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  // Match both /admin/auth/login and /{region}/admin/auth/login
  return path.includes('/admin/auth/login') || path.endsWith('/admin/auth/login');
};

// Redirect to SSO login
const redirectToSSO = (): void => {
  if (typeof window === 'undefined') return;
  const region = getRegionFromPath();
  const ssoUrl = `/${region}/strapi-plugin-sso/oidc`;
  console.log('[SSO] Session expired, redirecting to SSO:', ssoUrl);
  window.location.href = ssoUrl;
};

// Get auth server OIDC URL for the current region
const getAuthServerUrl = (): string => {
  if (typeof window === 'undefined') return 'https://auth.defcon.run/use1/api/oidc';
  const region = getRegionFromPath();
  // Use private service discovery in production (but URL here is for browser redirect)
  return `https://auth.defcon.run/${region}/api/oidc`;
};

// Redirect to auth server's end_session endpoint for full logout
const redirectToOIDCLogout = (): void => {
  if (typeof window === 'undefined') return;
  const region = getRegionFromPath();
  const authServerUrl = getAuthServerUrl();

  // Build the end_session URL with post_logout_redirect_uri
  const endSessionUrl = new URL(`${authServerUrl}/session/end`);
  const postLogoutRedirectUri = `${window.location.origin}/${region}/admin`;
  endSessionUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

  console.log('[SSO] Logging out via OIDC end_session:', endSessionUrl.toString());
  window.location.href = endSessionUrl.toString();
};

// Auto-redirect to SSO on login page (only runs in browser)
if (typeof window !== 'undefined' && shouldRedirectToSSO()) {
  // Small delay to ensure any cleanup happens first
  setTimeout(redirectToSSO, 100);
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
