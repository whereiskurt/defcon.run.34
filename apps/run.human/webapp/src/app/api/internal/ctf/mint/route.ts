import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getMeshGhost } from "@/lib/mesh-ghosts";
import { deriveFlagCode } from "@/lib/mesh-otp-derive";
import { hashAnswer } from "@/lib/ctf-hash";
import { getCtf, listCtf } from "@/lib/qr-admin";
import {
  createPending,
  newAwardNonce,
  AWARD_LINK_TTL_SECONDS,
} from "@/lib/ctf-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: mint a single-use award claim link.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only; the meshtk bots are
 * the sole callers). Two request shapes:
 *
 *   { challenge: "ricky" }        — resolve the Ctf row by name with a single
 *                                   GetItem and park the row's OWN answerHash.
 *   { ghost: "ghost.goldstein" }  — derive the ghost's REAL covert flag code
 *                                   server-side (the code never travels
 *                                   bot→run.human) and resolve its challenge.
 *
 * Either way the result is parked as a short-ttl CtfPending nonce and returned
 * as an award URL. The nonce is consumed on first claim (claimPending deletes
 * the row), so a shared link awards at most once.
 *
 * Ghost challenge resolution prefers an EXPLICIT `challenge` recorded on the
 * flag-challenge blob (a GetItem). Without one it falls back to an ANSWER-HASH
 * match over the Ctf table — the same rule the rekey sync uses. That fallback
 * MUST NOT be removed: persona challenge names don't uniformly derive from fleet
 * ids (e.g. challenge "grace-hopper" ↔ "ghost.hopper"), which is the entire
 * reason the scan exists. A ghost that resolves to nothing 422s and the bot falls
 * back to its static-code reveal.
 *
 * HYGIENE: the derived code, the row's answerHash and the nonce are never logged
 * here (mirrors the claim page's no-logging rule).
 */

/** The Ctf attributes this route reads (structural — no entity import). */
interface MintableRow {
  challenge: string;
  enabled?: boolean;
  answerHash?: string;
}

/** Nothing to mint — the bot falls back to its static-code reveal. */
function unmintable() {
  return NextResponse.json({ error: "Unmintable" }, { status: 422 });
}

/**
 * Resolve a challenge name to a mintable row with ONE GetItem — never a scan.
 * Returns null for a missing row, an explicitly disabled one, or one carrying no
 * answerHash (e.g. a rotating-OTP flag): parking a nonce for any of those would
 * hand the player a link that can never award. The caller maps null to a 422 so
 * the bot falls back rather than hanging.
 */
async function resolveMintableRow(challenge: string): Promise<MintableRow | null> {
  const row = (await getCtf(challenge)) as MintableRow | null;
  if (!row || row.enabled === false || !row.answerHash) return null;
  return row;
}

/**
 * Park a resolved row's OWN answerHash as the pending guess hash. No raw flag
 * code needs to exist anywhere for this path — it redeems because `judgeSolve`
 * compares `verifyAnswerHash(guessHash, ctf.answerHash)` for `answerType:
 * "static"` (ctf-judge.ts). The empty guess argument is never hashed: `flagHash`
 * takes precedence inside createPending.
 */
function parkRow(row: MintableRow) {
  return createPending(row.challenge, "", {
    flagHash: row.answerHash,
    ttlSeconds: AWARD_LINK_TTL_SECONDS,
    newNonce: newAwardNonce,
  });
}

/**
 * The award URL. In production this is the reserved single-letter `/a/`
 * namespace on the q resolver (a pure lexical rewrite — no DynamoDB read), which
 * is short enough to survive a LoRa packet. In dev there is no q resolver
 * running locally, so the direct claim-page URL is returned instead.
 */
function awardUrl(nonce: string): string {
  if (config.isDev) {
    const base = process.env.RUN_PUBLIC_URL || "http://localhost:3001";
    return `${base}/ctf/claim?nonce=${nonce}`;
  }
  const base =
    process.env.AWARD_LINK_BASE_URL || `https://q.${config.siteDomain}`;
  return `${base}/a/${nonce}`;
}

function minted(nonce: string) {
  return NextResponse.json(
    { nonce, url: awardUrl(nonce) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ghostId: unknown;
  let challengeName: unknown;
  try {
    const body = await req.json();
    ghostId = body?.ghost;
    challengeName = body?.challenge;
  } catch {
    ghostId = undefined;
    challengeName = undefined;
  }
  const hasChallenge = typeof challengeName === "string" && challengeName.length > 0;
  const hasGhost = typeof ghostId === "string" && ghostId.length > 0;
  if (!hasChallenge && !hasGhost) {
    return NextResponse.json({ error: "Missing ghost or challenge" }, { status: 400 });
  }

  // Explicit beats inferred: a named challenge wins over a ghost id, and never scans.
  if (hasChallenge) {
    const row = await resolveMintableRow(challengeName as string);
    if (!row) return unmintable();
    const { nonce } = await parkRow(row);
    return minted(nonce);
  }

  const serverSecret = process.env.MESHTK_GHOST_KEY_SECRET;
  const ghost = getMeshGhost(ghostId as string);
  if (!serverSecret || !ghost?.flagCode) {
    // Unconfigured environment or unknown/flagless ghost → the bot falls back.
    return unmintable();
  }

  // The operator named this ghost's challenge → GetItem, no scan, no raw code parked.
  if (ghost.challenge) {
    const row = await resolveMintableRow(ghost.challenge);
    if (!row) return unmintable();
    const { nonce } = await parkRow(row);
    return minted(nonce);
  }

  // FALLBACK — answer-hash match over the whole table. This exists because persona
  // challenge names do not uniformly derive from fleet ids ("grace-hopper" ↔
  // "ghost.hopper"); it must not be removed. Give a ghost an explicit `challenge`
  // in MESHTK_FLAG_CHALLENGES to take the GetItem path above instead.
  const code = deriveFlagCode(serverSecret, ghost.id, ghost.flagCode);
  const codeHash = hashAnswer(code);
  const rows = await listCtf();
  const match =
    rows.find((r) => r.answerHash === codeHash && r.enabled === true) ??
    rows.find((r) => r.answerHash === codeHash);
  if (!match) return unmintable();

  const { nonce } = await createPending(match.challenge, code, {
    ttlSeconds: AWARD_LINK_TTL_SECONDS,
    newNonce: newAwardNonce,
  });
  return minted(nonce);
}
