/**
 * Resolve an OIDC sub (= AuthProfile.userId) to its downstream run.human user
 * via run.human's existing secret-gated internal endpoint. Fail-soft: any error
 * or non-2xx yields {found:false} — the auth data is authoritative, the
 * run.human column is best-effort.
 *
 * The shared secret is read directly from process.env.AUTH_INTERNAL_SECRET,
 * matching run.auth's existing internal-secret convention (session/validate,
 * admin/*, internal/* routes all do the same). run.auth has no
 * config.auth.internalSecret wrapper.
 */

export type RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null };

const NONE: RunHumanRef = { found: false, runUserId: null, displayName: null };
// run.human is mounted at Next basePath `/{region}` in prod, so its internal
// route lives at `/{region}/api/internal/...`. A naked `https://run.defcon.run/
// api/internal/...` 404s → the auth-admin run.human tie-back returned not-found
// for EVERYONE (rabbit pseudonyms instead of real names). Default the base to the
// region-prefixed public URL; an explicit RUN_HUMAN_INTERNAL_URL override must
// itself include the correct prefix.
const REGION = process.env.REGION_SHORT || "use1";
const BASE = process.env.RUN_HUMAN_INTERNAL_URL || `https://run.defcon.run/${REGION}`;

export async function resolveRunHuman(sub: string, fetchImpl: typeof fetch = fetch): Promise<RunHumanRef> {
  try {
    const res = await fetchImpl(`${BASE}/api/internal/user/${encodeURIComponent(sub)}?summary=1`, {
      headers: { "x-internal-secret": process.env.AUTH_INTERNAL_SECRET ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return NONE;
    const body = (await res.json()) as Partial<RunHumanRef>;
    return {
      found: body.found === true || body.runUserId != null,
      runUserId: body.runUserId ?? null,
      displayName: body.displayName ?? null,
    };
  } catch {
    return NONE;
  }
}

export async function resolveRunHumanMany(subs: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, RunHumanRef>> {
  const out: Record<string, RunHumanRef> = {};
  const CONCURRENCY = 8;
  let i = 0;
  async function worker() {
    while (i < subs.length) {
      const idx = i++;
      const sub = subs[idx];
      out[sub] = await resolveRunHuman(sub, fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));
  return out;
}
