'use client';

import { signOut } from 'next-auth/react';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Extract the region prefix from the current URL path.
 * E.g., /use1/dashboard -> use1, /cac1/profile -> cac1
 */
function getRegionFromPath(): string {
  if (typeof window === 'undefined') return 'use1';
  const match = window.location.pathname.match(/^\/(use1|cac1)/);
  return match ? match[1] : 'use1';
}

/**
 * Get the auth server OIDC URL based on the current region.
 * In production, the auth server is at auth.defcon.run/{region}/api/oidc
 */
function getAuthServerUrl(): string {
  if (isDev) return 'http://localhost:3002/api/oidc';
  const region = getRegionFromPath();
  return `https://auth.defcon.run/${region}/api/oidc`;
}

/**
 * Custom logout handler that properly terminates both:
 * 1. The OIDC session on auth.defcon.run (clears oidc-provider session)
 * 2. The NextAuth session on run.human (clears sess_run cookie)
 *
 * This prevents the issue where logging back in skips credentials
 * because the OIDC session was still active.
 */
export async function fullLogout(callbackUrl: string = '/'): Promise<void> {
  // Step 1: Call NextAuth signOut to clear local session
  // We use redirect: false so we can control the redirect ourselves
  await signOut({ redirect: false });

  // Step 2: Redirect to OIDC end_session endpoint to terminate the OIDC session
  // This will clear the oidc-provider session cookies and redirect back to us
  const authServerUrl = getAuthServerUrl();
  const endSessionUrl = new URL(`${authServerUrl}/session/end`);

  // Get the current origin for the post-logout redirect
  // Include the region prefix in the callback URL
  const region = getRegionFromPath();
  const fullCallbackUrl = callbackUrl.startsWith('/') && !callbackUrl.startsWith(`/${region}`)
    ? `/${region}${callbackUrl}`
    : callbackUrl;
  const postLogoutRedirectUri = typeof window !== 'undefined'
    ? `${window.location.origin}${fullCallbackUrl}`
    : callbackUrl;

  endSessionUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

  // Redirect to the OIDC end session endpoint
  window.location.href = endSessionUrl.toString();
}

/**
 * React hook that provides the logout function
 */
export function useLogout() {
  return { logout: fullLogout };
}
