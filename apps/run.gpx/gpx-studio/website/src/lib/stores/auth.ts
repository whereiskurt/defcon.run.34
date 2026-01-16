/**
 * Authentication Store for GPX Studio
 * Manages auth state via NextAuth session endpoint.
 *
 * This store:
 * - Fetches session from /api/auth/session
 * - Checks for 'gpxstudio' service claim
 * - Provides logout functionality
 * - Exposes user info including optional mapbox token
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export interface User {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  services?: string[];
  mapboxPublicToken?: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasGpxStudioAccess: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isLoading: true,
  isAuthenticated: false,
  hasGpxStudioAccess: false,
  error: null,
};

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>(initialState);

  async function checkSession(): Promise<AuthState> {
    if (!browser) {
      return initialState;
    }

    update(state => ({ ...state, isLoading: true, error: null }));

    try {
      const response = await fetch('/api/auth/session', {
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
          error: hasAccess ? null : 'Access denied - gpxstudio service required',
        };

        set(newState);
        return newState;
      } else {
        const newState: AuthState = {
          user: null,
          isLoading: false,
          isAuthenticated: false,
          hasGpxStudioAccess: false,
          error: null,
        };
        set(newState);
        return newState;
      }
    } catch (error) {
      const newState: AuthState = {
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasGpxStudioAccess: false,
        error: 'Failed to check session',
      };
      set(newState);
      return newState;
    }
  }

  function login() {
    if (browser) {
      window.location.href = '/api/auth/signin';
    }
  }

  function logout() {
    if (browser) {
      window.location.href = '/api/auth/signout';
    }
  }

  function reset() {
    set(initialState);
  }

  return {
    subscribe,
    checkSession,
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
export const authError = derived(auth, $auth => $auth.error);

// Get user's mapbox token (or undefined to use default)
export const userMapboxToken = derived(auth, $auth => $auth.user?.mapboxPublicToken);
