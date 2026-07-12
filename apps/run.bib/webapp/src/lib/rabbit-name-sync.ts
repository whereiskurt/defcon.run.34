/**
 * Bib-name -> rabbit-name sync (run.bib caller side).
 *
 * When a runner saves their bib name we best-effort propagate it to their
 * run.human rabbit name (displayName) via the secret-gated internal PATCH
 * endpoint. Fail-open: nothing here may ever throw into or fail the bib save.
 *
 * The internal-URL + X-Internal-Secret derivation mirrors lib/social-qr.ts (the
 * RUN_HUMAN_INTERNAL_URL fallback host + basePath=/{region} in prod). See
 * docs/superpowers/specs/2026-07-11-bib-name-rabbit-sync-design.md.
 */

const DISPLAYNAME_MIN = 3;
const DISPLAYNAME_MAX = 20;

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";

const HUMAN_BASE_URL =
  process.env.RUN_HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(
        /\./g,
        "-"
      )}.local:3000/${region}`);

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";

/**
 * Reconcile a bib name to run.human's 3-20 rabbit-name rules.
 * Returns null when it can't be synced (< 3 chars after trim), else the trimmed
 * name clamped to 20 chars.
 */
export function normalizeSyncedName(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < DISPLAYNAME_MIN) return null;
  return trimmed.slice(0, DISPLAYNAME_MAX);
}

/**
 * PATCH the run.human internal endpoint to set the runner's displayName.
 * Returns res.ok; resolves false (never throws) on any failure — the bib save
 * must never be affected by a sync miss.
 */
export async function syncRabbitName(
  ownerSub: string,
  name: string
): Promise<boolean> {
  try {
    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(
      ownerSub
    )}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ displayName: name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Normalize + guard + best-effort sync. Never throws.
 * - "skipped": name too short to be a valid rabbit name (nothing sent).
 * - "synced":  run.human accepted the write (2xx).
 * - "failed":  a valid name was sent but the call failed/non-2xx.
 * (Note: run.human still independently refuses manually-claimed names; a
 * "synced" here means the endpoint returned 2xx, which includes its own
 * {synced:false,reason:"manual"} no-op — that is the correct, safe outcome.)
 */
export async function maybeSyncRabbitName(
  ownerSub: string,
  rawName: string
): Promise<"synced" | "skipped" | "failed"> {
  const name = normalizeSyncedName(rawName);
  if (!name) return "skipped";
  try {
    return (await syncRabbitName(ownerSub, name)) ? "synced" : "failed";
  } catch {
    return "failed";
  }
}
