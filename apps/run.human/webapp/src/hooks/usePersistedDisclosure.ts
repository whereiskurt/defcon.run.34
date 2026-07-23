'use client';

import { useState, useCallback } from 'react';

const PREFIX = 'whoami-panel:';

/**
 * Collapsible-panel open state that survives navigation and reloads
 * (per-browser, via localStorage). Drop-in for
 * `useState(defaultOpen)` — the whoami panels each pass a stable key so
 * whatever the runner left open or closed stays that way, instead of every
 * visit resetting to the hardcoded defaults (Kurt UAT 2026-07-23: the
 * check-ins panel re-opening every time shuffled the whole page around).
 *
 * The stored value only changes on explicit set — programmatic expands
 * (e.g. auto-opening check-ins after "Add a check-in") persist too, which
 * is the intent: the page reflects the runner's last interaction.
 */
export function usePersistedDisclosure(key: string, defaultOpen = false) {
  const [isOpen, setIsOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    try {
      const stored = window.localStorage.getItem(PREFIX + key);
      return stored === null ? defaultOpen : stored === '1';
    } catch {
      return defaultOpen;
    }
  });

  const setIsOpen = useCallback(
    (next: boolean) => {
      setIsOpenState(next);
      try {
        window.localStorage.setItem(PREFIX + key, next ? '1' : '0');
      } catch {
        // Private browsing / storage denied — state still works for this visit.
      }
    },
    [key],
  );

  return [isOpen, setIsOpen] as const;
}
