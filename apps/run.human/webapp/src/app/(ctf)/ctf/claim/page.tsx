import { cookies } from "next/headers";
import { auth } from "@/config/auth";
import { isCtfAdmin } from "@/lib/admin-gate";
import { normalizeChallenge } from "@/lib/qr-admin";
import { judgeSolve } from "@/lib/ctf-judge";
import { createPending, claimPending } from "@/lib/ctf-pending";
import ClaimClient from "./ClaimClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link-preview identity (ghost magic links unfurl this page). The image is the
 * code-generated 777 card served by ./og/route.tsx; its og:image URL is built
 * EXPLICITLY from RUN_PUBLIC_URL (which already carries the /{region}
 * basePath) because crawlers require an absolute src. Copy is code-free — the
 * flag code / nonce never appears in the card. Crawlers are anonymous, so
 * fetching the page never claims anything (the anon branch only hands the
 * nonce to the client).
 */
const OG_TITLE = "🎰 777 — you found a flag!";
const OG_DESCRIPTION =
  "Jackpot. Tap in to claim your DEF CON 34 run CTF flag before the reels reset.";
const OG_IMAGE = `${process.env.RUN_PUBLIC_URL ?? ""}/ctf/claim/og`;

export const metadata = {
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/**
 * The VISIBLE, PUBLIC CTF claim page (CTF-05, CTF-06). The live q.defcon.run
 * resolver 302-forwards a physical QR scan to `/use1/ctf/claim?c=<challenge>&v=<guess>`.
 * This page reads the session opportunistically and wires the flow branches:
 *
 *   (N1) signed-in + ?nonce → claimPending now → credit EXACTLY ONCE (ghost
 *        magic links: the nonce was minted by /api/internal/ctf/mint and the
 *        row is deleted on claim, so a shared link awards at most once).
 *   (N2) anon      + ?nonce → hand the nonce to ClaimClient (it parks it in the
 *        ctf_pending cookie) → "sign in to claim" CTA → branch (B) redeems.
 *   (A) signed-in + params → judgeSolve now → visible award / graceful non-award.
 *   (C) anon      + params → createPending (park the hash) → "sign in to claim" CTA.
 *   (B) signed-in + parked nonce cookie → claimPending → credit EXACTLY ONCE.
 *
 * HYGIENE (T-45-05): this page performs NO logging. The raw guess `v` is handed
 * ONLY to judgeSolve/createPending, which hash it and never log the value. There
 * is intentionally no logging call whatsoever in this file.
 *
 * ATTRIBUTION (T-45-06/07): credit is keyed to the server-resolved
 * `session.user.id` (the Auth.js adapter uuid) ONLY — never the OIDC sub
 * `session.user.authUserId`, never an id from the query/cookie. This is the
 * key space `RunUser.userId` lives in: scoring writes `RunUser.ctfScore` via
 * `RunUser.patch({ userId: user })` and the CTF leaderboard joins on that same
 * RunUser row, so the player id MUST be `session.user.id` to accrue and rank
 * (using the OIDC sub here patches a nonexistent row → the score is lost). A
 * missing/empty id falls through to the anonymous park-and-claim path (never
 * passes `undefined` to judgeSolve).
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
  searchParams: Promise<{
    c?: string | string[];
    v?: string | string[];
    nonce?: string | string[];
  }>;
}) {
  const { c, v, nonce: nonceParam } = await searchParams;
  const session = await auth();

  // Player key: the Auth.js adapter uuid (`RunUser.userId` space), and ONLY when
  // it is a non-empty string. Anything else (no session, undefined id) is treated
  // as anonymous.
  const userId = session?.user?.id;
  const player =
    typeof userId === "string" && userId.length > 0 ? userId : null;

  const challenge = safeNormalize(c);
  const guess = typeof v === "string" && v.length > 0 ? v : null;
  const linkNonce =
    typeof nonceParam === "string" && nonceParam.length > 0 ? nonceParam : null;

  // (N1) SIGNED-IN + ?nonce → redeem the minted claim link now. A spent/expired
  // nonce is an idempotent non-award (claimPending returns NON_SOLVE).
  if (player && linkNonce) {
    const result = await claimPending(linkNonce, player);
    return <ClaimClient mode="result" result={result} clearNonce />;
  }

  // (N2) ANON + ?nonce → park it (ClaimClient writes the ctf_pending cookie)
  // and prompt sign-in; the signed-in return hits branch (B).
  if (!player && linkNonce) {
    return <ClaimClient mode="signin" nonce={linkNonce} />;
  }

  // (A) SIGNED-IN + params → judge the solve now. A CTF-admin operator re-submit
  // re-scores against the current config (idempotent) and bypasses the attempt
  // cap — see judgeSolve `admin`. Non-admins are unaffected.
  if (player && challenge && guess) {
    const result = await judgeSolve({
      user: player,
      challenge,
      guess,
      channel: "qr",
      admin: isCtfAdmin(session),
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
