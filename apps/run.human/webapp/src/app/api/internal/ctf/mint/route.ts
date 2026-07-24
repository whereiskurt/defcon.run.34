import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getMeshGhost } from "@/lib/mesh-ghosts";
import { deriveFlagCode } from "@/lib/mesh-otp-derive";
import { hashAnswer } from "@/lib/ctf-hash";
import { listCtf } from "@/lib/qr-admin";
import { createPending, CLAIM_LINK_TTL_SECONDS } from "@/lib/ctf-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: mint a single-use ghost flag-claim link.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only; the meshtk ghosts
 * container is the sole caller). Given a fleet ghost id (e.g. "ghost.goldstein"),
 * derives the ghost's REAL covert flag code server-side (the code never travels
 * bot→run.human), parks it as a short-ttl CtfPending nonce, and returns the
 * claim URL. The nonce is consumed on first claim (claimPending deletes the
 * row), so a shared link awards at most once.
 *
 * Challenge resolution is by ANSWER-HASH match against the Ctf table — the same
 * rule the rekey sync uses — because persona challenge names don't uniformly
 * derive from fleet ids (e.g. challenge "grace-hopper" ↔ "ghost.hopper"). A
 * ghost whose derived code matches no row 422s and the bot falls back to its
 * static-code reveal.
 *
 * HYGIENE: the derived code and nonce are never logged here (mirrors the claim
 * page's no-logging rule).
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ghostId: unknown;
  try {
    ghostId = (await req.json())?.ghost;
  } catch {
    ghostId = undefined;
  }
  if (typeof ghostId !== "string" || ghostId.length === 0) {
    return NextResponse.json({ error: "Missing ghost" }, { status: 400 });
  }

  const serverSecret = process.env.MESHTK_GHOST_KEY_SECRET;
  const ghost = getMeshGhost(ghostId);
  if (!serverSecret || !ghost?.flagCode) {
    // Unconfigured environment or unknown/flagless ghost → the bot falls back.
    return NextResponse.json({ error: "Unmintable" }, { status: 422 });
  }

  const code = deriveFlagCode(serverSecret, ghost.id, ghost.flagCode);
  const codeHash = hashAnswer(code);
  const rows = await listCtf();
  const match =
    rows.find((r) => r.answerHash === codeHash && r.enabled === true) ??
    rows.find((r) => r.answerHash === codeHash);
  if (!match) {
    return NextResponse.json({ error: "Unmintable" }, { status: 422 });
  }

  const { nonce } = await createPending(match.challenge, code, {
    ttlSeconds: CLAIM_LINK_TTL_SECONDS,
  });
  const base =
    process.env.RUN_PUBLIC_URL ||
    (config.isDev
      ? "http://localhost:3001"
      : `https://run.${config.siteDomain}/${config.region}`);
  return NextResponse.json(
    { nonce, url: `${base}/ctf/claim?nonce=${nonce}` },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
