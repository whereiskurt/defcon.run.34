"use client";

/**
 * covert-egg — the egg-side client for the covert CSS channel (CTF-09).
 *
 * On the `!!!` trigger it injects a `<link rel=stylesheet>` to the covert path
 * (46-02: `/assets/theme`) with the flag encoded into a build-date-looking `?v=`
 * (46-01: encodeFlag), waits for the stylesheet `load`, then reads the award back
 * via `getComputedStyle(document.documentElement).getPropertyValue(AWARD_PROP)` —
 * a COMPUTED-STYLE read, never a fetch-body parse and never a CSSOM-rule read, so
 * a network watcher sees only a stylesheet load (T-46-11).
 *
 * Deferred claim (SC2): the client cannot know its auth state, so on every fire
 * the encoded `v` is stashed in localStorage (PENDING_KEY). On a later signed-in
 * page load `claimStashed` re-fires each parked `v` through the SAME covert
 * endpoint; judgeSolve's conditional-put makes a re-submitted already-credited
 * flag a safe no-op (T-46-15). NO nonce/cookie/header ever comes back from the
 * server — the only claim material is the client's own stashed `v`, so the covert
 * response stays byte-identical across win/wrong/unauth (T-46-14, invisibility).
 *
 * Browser-only: DOM/localStorage are touched ONLY inside functions (guarded), so
 * the module is import-safe under SSR and the vitest node env.
 */

import { encodeFlag } from "@/lib/ctf-covert-codec";
import { AWARD_PROP } from "@/lib/ctf-covert-css";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const basePath = isDev ? "" : `/${region}`;

/** localStorage key holding the array of encoded `v` parked for later claim. */
export const PENDING_KEY = "dc34:covert:pending";

/** Fallback resolve window if the stylesheet never emits load/error. */
const LOAD_TIMEOUT_MS = 1500;

/** `<basePath>/assets/theme?v=<v>` for an already-encoded v (claim re-fire). */
export function buildCovertUrlFromV(v: string): string {
  return `${basePath}/assets/theme?v=${v}`;
}

/** Encode (challenge, guess) into the covert URL — the build-date-looking ?v=. */
export function buildCovertUrl(challenge: string, guess: string): string {
  return buildCovertUrlFromV(encodeFlag(challenge, guess));
}

/** Win gate: true iff the marker trims to a finite numeric value > 0. */
export function shouldCelebrate(marker: string): boolean {
  if (typeof marker !== "string") return false;
  const t = marker.trim();
  if (t === "") return false;
  const n = Number(t);
  return Number.isFinite(n) && n > 0;
}

/** Read the award marker off the computed style of <html> (never the CSSOM). */
export function readAward(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(AWARD_PROP);
  } catch {
    return "";
  }
}

/** Parked encoded-v list; a missing/broken localStorage yields []. */
export function readPending(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Append v (deduped) to the parked list; silent no-op on any storage failure. */
export function stashPending(v: string): void {
  try {
    const cur = readPending();
    if (cur.includes(v)) return;
    cur.push(v);
    localStorage.setItem(PENDING_KEY, JSON.stringify(cur));
  } catch {
    /* no-op */
  }
}

/** Remove v from the parked list; silent no-op on any storage failure. */
export function clearPending(v: string): void {
  try {
    const next = readPending().filter((x) => x !== v);
    localStorage.setItem(PENDING_KEY, JSON.stringify(next));
  } catch {
    /* no-op */
  }
}

/**
 * Monotonic per-page counter feeding the cache-buster below. Guarantees a
 * distinct token for every fire within a page load (even two in the same ms).
 */
let _cbSeq = 0;

/**
 * A unique-per-fire token for the covert URL. The covert URL for a given
 * (challenge, guess) is otherwise DETERMINISTIC, so a second `<link>` to the same
 * href is served from the browser's in-memory cache WITHOUT a network request
 * (memory cache reuses an identical in-page subresource even under `no-store`).
 * That silently blocks every repeat `!!!` from re-hitting the judge — the score
 * never changes. A time component (differs across page loads / any CDN) plus the
 * monotonic counter (differs within a page load) makes each fire a real request.
 * The server reads ONLY `v` and ignores this param.
 */
function defaultCacheBust(): string {
  return `${Date.now().toString(36)}${(_cbSeq++).toString(36)}`;
}

/**
 * Inject the covert stylesheet for an already-encoded v, resolve on its load (or
 * a timeout fallback), read the award back via computed style, remove the link,
 * and report the win. The win decision derives SOLELY from `readAward()`.
 *
 * The href carries a unique `&_=` cache-buster (see defaultCacheBust) so a repeat
 * fire of the SAME flag always re-hits the server instead of the browser cache —
 * without it, re-tests / the admin re-score override never reach the judge.
 */
export function fireCovert(
  v: string,
  onResult: (win: boolean) => void,
  deps: { cacheBust?: () => string } = {},
): void {
  if (typeof document === "undefined") {
    onResult(false);
    return;
  }
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const link = document.createElement("link");
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    let win = false;
    try {
      win = shouldCelebrate(readAward());
    } catch {
      win = false;
    }
    try {
      link.remove();
    } catch {
      /* ignore */
    }
    onResult(win);
  };
  const bust = (deps.cacheBust ?? defaultCacheBust)();
  link.rel = "stylesheet";
  link.href = `${buildCovertUrlFromV(v)}&_=${bust}`;
  link.addEventListener("load", finish);
  link.addEventListener("error", finish);
  timer = setTimeout(finish, LOAD_TIMEOUT_MS);
  document.head.appendChild(link);
}

/**
 * Fire the egg for a (challenge, guess): stash the encoded v FIRST (the client
 * cannot know auth state), then fire the covert hit; a same-fire win clears its
 * own parked entry so it is never re-claimed.
 */
export function fireEgg(
  challenge: string,
  guess: string,
  onResult: (win: boolean) => void,
): void {
  const v = encodeFlag(challenge, guess);
  stashPending(v);
  fireCovert(v, (win) => {
    if (win) clearPending(v);
    onResult(win);
  });
}

/**
 * Redeem every parked flag on a signed-in load: re-fire each v through the covert
 * endpoint; a win clears that v and invokes onWin. Re-firing an already-credited
 * v is a safe no-op (judgeSolve conditional-put), so this is idempotent.
 */
export function claimStashed(onWin?: () => void): void {
  for (const v of readPending()) {
    fireCovert(v, (win) => {
      if (win) {
        clearPending(v);
        onWin?.();
      }
    });
  }
}
