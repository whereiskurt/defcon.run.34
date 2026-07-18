"use client";

/**
 * CopyProvider / useCopy — the CLIENT half of the run.bib copy toolkit (Phase 36-03).
 *
 * The server (layout.tsx) resolves the copy map via loadCopy() and hands ONLY that
 * already-resolved map to <CopyProvider value={map}>. useCopy() returns a bound `t`
 * so a client modal / toast / event handler resolves an interpolated key at RUNTIME
 * (SC-2, TOOL-03) — using the exact same O(1) lookup path as the server (`t` from
 * copy-core).
 *
 * SECURITY BOUNDARY (T-36-08): this module is client-side. It imports ONLY the
 * client-safe copy-core (`t`) and the committed copy-snapshot.json floor. It MUST
 * NEVER import the server-only lib/copy resolver — that reads STRAPI_API_TOKEN /
 * CMS_INTERNAL_URL and would leak the token into the client bundle. Only the
 * resolved copy map crosses the server->client boundary; never the token or CMS URL.
 *
 * CLIENT FLOOR (FALL-04): every lookup is `context[key] ?? snapshot[key] ?? key`.
 * The committed snapshot guarantees a snapshot-present key never renders as a raw
 * dotted key even if it was absent from the server-passed context, and useCopy()
 * called outside a provider still resolves (never throws, T-36-10).
 */

import * as React from "react";
import { t, type CopyMap } from "@/lib/copy-core";
import snapshot from "@/lib/copy-snapshot.json";

/** Committed client-side floor for the default locale (zero network, offline). */
const SNAPSHOT_FLOOR: CopyMap =
  (snapshot as Record<string, CopyMap>).default ?? {};

/** Empty default so useCopy() outside a provider floors cleanly to the snapshot. */
const CopyContext = React.createContext<CopyMap>({});

export interface CopyProviderProps {
  /**
   * The server-resolved copy map (from loadCopy). ONLY this crosses the
   * server->client boundary — never the CMS token or CMS_INTERNAL_URL.
   */
  value: CopyMap;
  children: React.ReactNode;
}

export function CopyProvider({ value, children }: CopyProviderProps) {
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
}

export interface UseCopy {
  /** Runtime copy lookup: context[key] ?? snapshot[key] ?? key, then interpolate. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * useCopy — returns a bound `t` for client components. The lookup merges the
 * committed snapshot floor UNDER the server-passed context (context wins), so a
 * key missing from context still resolves from the snapshot and a key missing
 * everywhere echoes itself.
 */
export function useCopy(): UseCopy {
  const context = React.useContext(CopyContext);
  const boundT = React.useCallback<UseCopy["t"]>(
    (key, vars) => t({ ...SNAPSHOT_FLOOR, ...context }, key, vars),
    [context]
  );
  return { t: boundT };
}
