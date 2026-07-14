import { decodeFlag } from "@/lib/ctf-covert-codec";
import { buildDecoySheet, buildWinSheet } from "@/lib/ctf-covert-css";
import { normalizeChallenge } from "@/lib/qr-admin";
import { judgeSolve } from "@/lib/ctf-judge";
import { createPending } from "@/lib/ctf-pending";

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
 * unauth → createPending (hash-only park) → decoy. It composes the committed
 * 46-01 primitives and the Phase-44/45 judge/park helpers — NO new scoring.
 *
 * HYGIENE (T-46-05): this handler performs NO logging of its own — the only
 * structured line is judgeSolve's coarse `ctfJudgeLog`. The raw guess is handed
 * ONLY to judgeSolve/createPending, which hash it. There is intentionally no
 * logging call whatsoever in this file (enforced by a source grep gate).
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

type CovertSession = { user?: { authUserId?: string } } | null;

export interface CovertDeps {
  getSession?: () => Promise<CovertSession>;
  judge?: typeof judgeSolve;
  park?: typeof createPending;
}

/** Lazy default so the test seam (and route import) never loads NextAuth. */
async function defaultGetSession(): Promise<CovertSession> {
  const { auth } = await import("@/config/auth");
  return (await auth()) as CovertSession;
}

/**
 * The testable core. GET calls it with production defaults; the route test
 * injects fakes (a fake CtfStore behind `judge`, a fake PendingStore behind
 * `park`, a stub session behind `getSession`) so no DynamoDB/auth is touched.
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
    const authUserId = session?.user?.authUserId;
    const player =
      typeof authUserId === "string" && authUserId.length > 0 ? authUserId : null;

    // Signed-in: judge the covert solve. A credited (points > 0) solve — first
    // hit OR idempotent replay of a prior award — renders the win sheet; every
    // other result (wrong, disabled, capped-to-0) renders the decoy.
    if (player) {
      const judge = deps.judge ?? judgeSolve;
      const result = await judge({ user: player, challenge, guess, channel: "covert" });
      if (result.solved && result.points > 0) return cssResponse(buildWinSheet(result.points));
      return cssResponse(buildDecoySheet());
    }

    // Unauth: park the flag (hash-only) for later signed-in claim, return decoy.
    const park = deps.park ?? createPending;
    await park(challenge, guess);
    return cssResponse(buildDecoySheet());
  } catch {
    // Total guard: any unexpected error still answers the plain decoy 200.
    return cssResponse(buildDecoySheet());
  }
}

export function GET(req: Request): Promise<Response> {
  return handleCovert(req);
}
