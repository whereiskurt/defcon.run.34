/**
 * Authentication Store for GPX Studio
 * Manages auth state via NextAuth session endpoint.
 *
 * This store:
 * - Fetches session from /api/auth/session
 * - Checks for 'gpxstudio' service claim
 * - Provides logout functionality
 * - Exposes user info including optional mapbox token
 * - Periodically validates session to detect expiry
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { base } from '$app/paths';

// Session validation interval (5 minutes)
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;

export interface User {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  services?: string[];
  mapboxPublicToken?: string;
  // True when the runner has linked Strava (Phase 61). Set server-side in the
  // run.gpx session callback; gates the "Sync my Strava" door in the hub.
  hasStrava?: boolean;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasGpxStudioAccess: boolean;
  hasStrava: boolean;
  error: string | null;
  lastChecked: number | null;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
  isAuthenticated: false,
  hasGpxStudioAccess: false,
  hasStrava: false,
  error: null,
  lastChecked: null,
};

// Get auth API base path
function getAuthBase(): string {
  return base.replace('/studio', '') + '/api/auth';
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>(initialState);
  let sessionCheckInterval: ReturnType<typeof setInterval> | null = null;

  async function checkSession(redirectOnExpired = false): Promise<AuthState> {
    if (!browser) {
      return initialState;
    }

    update(state => ({ ...state, isLoading: true, error: null }));

    try {
      const response = await fetch(`${getAuthBase()}/session`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to check session');
      }

      const session = await response.json();

      if (session?.user) {
        // Ensure services is always an array (guard against malformed session data)
        const rawServices = session.user.services;
        const services: string[] = Array.isArray(rawServices) ? rawServices : [];
        const hasAccess = services.includes('gpxstudio');

        const newState: AuthState = {
          user: session.user,
          isLoading: false,
          isAuthenticated: true,
          hasGpxStudioAccess: hasAccess,
          hasStrava: session.user.hasStrava === true,
          error: hasAccess ? null : 'Access denied - gpxstudio service required',
          lastChecked: Date.now(),
        };

        set(newState);
        return newState;
      } else {
        // Session expired or not authenticated
        const newState: AuthState = {
          user: null,
          isLoading: false,
          isAuthenticated: false,
          hasGpxStudioAccess: false,
          hasStrava: false,
          error: null,
          lastChecked: Date.now(),
        };
        set(newState);

        // Redirect to login if requested and session was expected
        if (redirectOnExpired) {
          redirectToLogin();
        }

        return newState;
      }
    } catch (error) {
      const newState: AuthState = {
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasGpxStudioAccess: false,
        hasStrava: false,
        error: 'Failed to check session',
        lastChecked: Date.now(),
      };
      set(newState);
      return newState;
    }
  }

  /**
   * Redirect to login page with current URL as callback
   */
  function redirectToLogin() {
    if (browser) {
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `${getAuthBase()}/signin?callbackUrl=${currentUrl}`;
    }
  }

  /**
   * Start periodic session validation.
   * Checks session every 5 minutes and redirects to login if expired.
   */
  function startSessionValidation() {
    if (!browser || sessionCheckInterval) {
      return;
    }

    sessionCheckInterval = setInterval(async () => {
      const state = await checkSession(false);
      // If user was authenticated but session is now gone, redirect to login
      if (!state.isAuthenticated) {
        console.log('Session expired, redirecting to login...');
        redirectToLogin();
      }
    }, SESSION_CHECK_INTERVAL);
  }

  /**
   * Stop periodic session validation.
   */
  function stopSessionValidation() {
    if (sessionCheckInterval) {
      clearInterval(sessionCheckInterval);
      sessionCheckInterval = null;
    }
  }

  function login() {
    if (browser) {
      window.location.href = `${getAuthBase()}/signin`;
    }
  }

  function logout() {
    stopSessionValidation();
    if (browser) {
      window.location.href = `${getAuthBase()}/signout`;
    }
  }

  function reset() {
    stopSessionValidation();
    set(initialState);
  }

  return {
    subscribe,
    checkSession,
    startSessionValidation,
    stopSessionValidation,
    redirectToLogin,
    login,
    logout,
    reset,
  };
}

export const auth = createAuthStore();

// Derived stores for convenient access
export const currentUser = derived(auth, $auth => $auth.user);
export const isAuthenticated = derived(auth, $auth => $auth.isAuthenticated);
export const isAuthLoading = derived(auth, $auth => $auth.isLoading);
export const hasGpxStudioAccess = derived(auth, $auth => $auth.hasGpxStudioAccess);
// True when the runner linked Strava — gates the "Sync my Strava" door (Phase 61).
export const hasStrava = derived(auth, $auth => $auth.hasStrava);
/** Admin can override the con-day picker with any calendar date (log/test any day). */
export const isAdmin = derived(auth, $auth => ($auth.user?.services ?? []).includes('admin'));
export const authError = derived(auth, $auth => $auth.error);

// Get user's mapbox token (or undefined to use default)
export const userMapboxToken = derived(auth, $auth => $auth.user?.mapboxPublicToken);
