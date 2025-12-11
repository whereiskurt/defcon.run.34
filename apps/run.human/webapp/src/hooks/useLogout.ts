'use client';

import { signOut } from 'next-auth/react';

const isDev = process.env.NODE_ENV !== 'production';
const authServerUrl = isDev
  ? 'http://localhost:3002/api/oidc'
  : 'https://auth.defcon.run/api/oidc';

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
  const endSessionUrl = new URL(`${authServerUrl}/session/end`);

  // Get the current origin for the post-logout redirect
  const postLogoutRedirectUri = typeof window !== 'undefined'
    ? `${window.location.origin}${callbackUrl}`
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
