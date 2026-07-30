import { decodeFlag } from "@/lib/ctf-covert-codec";
import { buildDecoySheet, buildWinSheet } from "@/lib/ctf-covert-css";
import { isCtfAdmin } from "@/lib/admin-gate";
import { normalizeChallenge } from "@/lib/qr-admin";
import { judgeSolve } from "@/lib/ctf-judge";

/**
 * The COVERT text/css channel (CTF-07/08/09) at `/use1/assets/theme`.
 *
 * This reads like a cache-busted theme stylesheet and is app-routed (route
 * handler → ALB origin, no `.css` extension) so Phase-48 can carve a dedicated
 * CloudFront behavior for it. EVERY outcome — signed-in-win, signed-in-wrong,
 * unauth, garbage — returns the SAME network envelope: HTTP 200, Content-Type
 * text/css, Cache-Control no-store. The ONLY observable difference is a value
 * buried in the CSS body (the presence-only `AWARD_PROP`), read back by the egg
 * client via getComputedStyle — never a status/header/size/log tell.
 *
 * Flow: decode `?v=` → null/disabled/wrong → decoy; signed-in + correct →
 * judgeSolve(channel "covert") → win sheet on a credited (points > 0) solve;
 * unauth → decoy, FULL STOP. Awards go ONLY to a visitor with a live run.human
 * session at fire time. A logged-out covert fire writes NOTHING: this channel
 * deliberately does NOT park a pending flag, because its nonce is never handed
 * back to a client (unlike the visible /ctf/claim QR page), so a parked row
 * could never be redeemed — it would only be dead, orphaned DB litter. It
 * composes the committed 46-01 primitives and the Phase-44 judge — NO new
 * scoring, NO anonymous footprint.
 *
 * HYGIENE (T-46-05): this handler performs NO logging of its own — the only
 * structured line is judgeSolve's coarse `ctfJudgeLog`. The raw guess is handed
 * ONLY to judgeSolve, which hashes it. There is intentionally no logging call
 * whatsoever in this file (enforced by a source grep gate).
 *
 * NEVER-THROW (T-46-07): a total guard wraps the whole body so any decode /
 * normalize / store error still returns the decoy 200 — never 302/401/JSON/5xx.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSS_HEADERS = {
  "Content-Type": "text/css; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

function cssResponse(body: string): Response {
  return new Response(body, { status: 200, headers: CSS_HEADERS });
}

/** Guarded normalize: a malformed/empty/reserved challenge → null, never throws. */
function safeNormalize(raw: string): string | null {
  try {
    return normalizeChallenge(raw);
  } catch {
    return null;
  }
}

type CovertSession = { user?: { id?: string; services?: string[] } } | null;

export interface CovertDeps {
  getSession?: () => Promise<CovertSession>;
  judge?: typeof judgeSolve;
}

/** Lazy default so the test seam (and route import) never loads NextAuth. */
async function defaultGetSession(): Promise<CovertSession> {
  const { auth } = await import("@/config/auth");
  return (await auth()) as CovertSession;
}

/**
 * The testable core. GET calls it with production defaults; the route test
 * injects fakes (a fake CtfStore behind `judge` and a stub session behind
 * `getSession`) so no DynamoDB/auth is touched.
 */
export async function handleCovert(req: Request, deps: CovertDeps = {}): Promise<Response> {
  try {
    const v = new URL(req.url).searchParams.get("v");
    const decoded = v ? decodeFlag(v) : null;
    if (!decoded) return cssResponse(buildDecoySheet());

    const challenge = safeNormalize(decoded.challenge);
    if (!challenge) return cssResponse(buildDecoySheet());
    const guess = decoded.guess;

    const getSession = deps.getSession ?? defaultGetSession;
    const session = await getSession();
    // Player key = the Auth.js adapter uuid (`RunUser.userId` space), never the
    // OIDC sub: the solve event is keyed on this row and the CTF leaderboard
    // joins on it, so the covert credit MUST key on `session.user.id`.
    const userId = session?.user?.id;
    const player =
      typeof userId === "string" && userId.length > 0 ? userId : null;

    // Signed-in: judge the covert solve. A credited (points > 0) solve — first
    // hit OR idempotent replay of a prior award — renders the win sheet; every
    // other result (wrong, disabled, capped-to-0) renders the decoy. A CTF-admin
    // operator bypasses the attempt cap (see judgeSolve `admin`), so operators
    // can test the egg loop; an already-solved flag always echoes the frozen
    // prior award — the judge no longer re-scores in place (points-consistency).
    if (player) {
      const judge = deps.judge ?? judgeSolve;
      const result = await judge({ user: player, challenge, guess, channel: "covert", admin: isCtfAdmin(session) });
      if (result.solved && result.points > 0) return cssResponse(buildWinSheet(result.points));
      return cssResponse(buildDecoySheet());
    }

    // Unauth: no session at fire time ⇒ no award and NO park. The covert channel
    // credits only a live-signed-in visitor; a logged-out fire returns the plain
    // decoy and leaves zero footprint (see the header note on why parking here
    // would only orphan an unredeemable row).
    return cssResponse(buildDecoySheet());
  } catch {
    // Total guard: any unexpected error still answers the plain decoy 200.
    return cssResponse(buildDecoySheet());
  }
}

export function GET(req: Request): Promise<Response> {
  return handleCovert(req);
}
