/**
 * Strapi Admin Panel Customization
 *
 * Auto-redirects to SSO login when session expires instead of showing
 * the internal Strapi login page. This provides a seamless re-authentication
 * experience for users.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any;
declare const localStorage: any;
declare function setTimeout(callback: () => void, ms: number): void;

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

    // Listen for 401 responses and redirect to SSO
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      // If we get a 401 on an admin API call, redirect to SSO
      if (response.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        if (url.includes('/admin/')) {
          console.log('[SSO] Got 401 on admin API, will redirect to SSO');
          // Clear any stale tokens
          localStorage.removeItem('jwtToken');
          localStorage.removeItem('isLoggedIn');
          // Redirect to SSO after a brief delay
          setTimeout(redirectToSSO, 500);
        }
      }

      return response;
    };
  },
};
