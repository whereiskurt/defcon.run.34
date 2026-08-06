/**
 * Notifying run.human that a runner earned the ELKENTARO 2000 treadmill flag.
 *
 * run.gpx knows whether an activity was indoor and when it was run; run.human
 * owns the CTF and the scoring. This is the seam between them, and it rides the
 * same secret-gated internal channel as `notifyAccomplishment`.
 *
 * The wire identity is `oidcSub` — in run.gpx `session.user.id` IS the OIDC sub,
 * and run.human resolves it to its own adapter userId (`getAdapterUserIdBySub`).
 * Passing run.human's adapter id here would silently award nobody.
 *
 * Best-effort by design, exactly like `notifyAccomplishment`: a flag that fails
 * to award must never break the import that earned it. The runner's run is the
 * thing they actually asked for.
 */

import { humanInternalUrl } from "./gpx-accomplishment";

/**
 * Grant the treadmill flag for `oidcSub`. Swallows every error and always
 * resolves. Awarding is idempotent server-side — judgeSolve replays an
 * already-solved challenge without double-scoring — so a retry is harmless.
 */
export async function awardTreadmillFlag(
  oidcSub: string,
  opts: { isAdmin?: boolean } = {},
  fetchImpl?: typeof fetch
): Promise<void> {
  try {
    const doFetch = fetchImpl ?? fetch;
    await doFetch(humanInternalUrl("/api/internal/ctf/treadmill-award"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header only, never logged (T-50-08).
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
      // `isAdmin` stops an operator's test import from consuming the non-admin
      // first-blood slot. It only ever removes a privilege, so it is safe to
      // derive from our own session and pass across.
      body: JSON.stringify({ oidcSub, isAdmin: opts.isAdmin === true }),
    });
  } catch {
    // Best-effort: a flag miss must never break the import.
  }
}

/** Fire-and-forget wrapper, mirroring `reconcileBestEffort`'s shape. */
export function awardTreadmillFlagBestEffort(
  oidcSub: string,
  opts: { isAdmin?: boolean } = {}
): void {
  void awardTreadmillFlag(oidcSub, opts).catch(() => {});
}
