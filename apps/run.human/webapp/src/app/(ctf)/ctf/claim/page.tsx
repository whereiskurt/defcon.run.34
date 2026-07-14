import { cookies } from "next/headers";
import { auth } from "@/config/auth";
import { normalizeChallenge } from "@/lib/qr-admin";
import { judgeSolve } from "@/lib/ctf-judge";
import { createPending, claimPending } from "@/lib/ctf-pending";
import ClaimClient from "./ClaimClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The VISIBLE, PUBLIC CTF claim page (CTF-05, CTF-06). The live q.defcon.run
 * resolver 302-forwards a physical QR scan to `/use1/ctf/claim?c=<challenge>&v=<guess>`.
 * This page reads the session opportunistically and wires the three flow branches:
 *
 *   (A) signed-in + params → judgeSolve now → visible award / graceful non-award.
 *   (C) anon      + params → createPending (park the hash) → "sign in to claim" CTA.
 *   (B) signed-in + parked nonce cookie → claimPending → credit EXACTLY ONCE.
 *
 * HYGIENE (T-45-05): this page performs NO logging. The raw guess `v` is handed
 * ONLY to judgeSolve/createPending, which hash it and never log the value. There
 * is intentionally no logging call whatsoever in this file.
 *
 * ATTRIBUTION (T-45-06/07): credit is keyed to the server-resolved
 * `session.user.authUserId` ONLY — never `session.user.id` (namespace mismatch),
 * never an id from the query/cookie. A missing/empty authUserId falls through to
 * the anonymous park-and-claim path (never passes `undefined` to judgeSolve).
 */
function safeNormalize(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeChallenge(raw);
  } catch {
    return null; // malformed/empty/reserved → graceful non-award, never throw
  }
}

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[]; v?: string | string[] }>;
}) {
  const { c, v } = await searchParams;
  const session = await auth();

  // Player key: the OIDC sub, and ONLY when it is a non-empty string. Anything
  // else (no session, undefined authUserId) is treated as anonymous.
  const authUserId = session?.user?.authUserId;
  const player =
    typeof authUserId === "string" && authUserId.length > 0 ? authUserId : null;

  const challenge = safeNormalize(c);
  const guess = typeof v === "string" && v.length > 0 ? v : null;

  // (A) SIGNED-IN + params → judge the solve now.
  if (player && challenge && guess) {
    const result = await judgeSolve({
      user: player,
      challenge,
      guess,
      channel: "qr",
    });
    return <ClaimClient mode="result" result={result} />;
  }

  // (C) ANON + params → park the flag (hash only) and prompt sign-in.
  if (!player && challenge && guess) {
    const { nonce } = await createPending(challenge, guess);
    return <ClaimClient mode="signin" nonce={nonce} />;
  }

  // (B) SIGNED-IN return (no usable params) → redeem a parked nonce if present.
  if (player) {
    const cookieStore = await cookies();
    const nonce = cookieStore.get("ctf_pending")?.value;
    if (nonce) {
      const result = await claimPending(nonce, player);
      return <ClaimClient mode="result" result={result} clearNonce />;
    }
  }

  // (D) Nothing to claim.
  return <ClaimClient mode="empty" />;
}
