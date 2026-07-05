import { solveChallenge } from "altcha-lib/v1";

import { begin, end } from "./altcha-overlay";

/**
 * Client-side ALTCHA solver (Kurt 2026-07-03). Fetches a challenge for the
 * given friction level, solves the proof-of-work in the browser, and returns
 * the base64 payload to attach to the mutating request (PATCH /api/bib), which
 * verifies it server-side.
 *
 * Naked `/api/altcha/challenge` path matches the existing BibForm `/api/bib`
 * fetch (nginx rewrites the region basePath in prod; dev has none).
 */
export type AltchaLevel = "save" | "toggle";

interface ChallengeResponse {
  algorithm: string;
  challenge: string;
  maxnumber?: number;
  maxNumber?: number;
  salt: string;
  signature: string;
}

export async function solveAltcha(level: AltchaLevel): Promise<string> {
  // Drive the once-mounted blur overlay (Plan 34-04, B-T4): begin() at entry,
  // end() in finally so every caller (save / toggle / checkout flush) raises and
  // dismisses the same shared "Checking you're human…" spinner, even on throw.
  begin();
  try {
    const res = await fetch(`/api/altcha/challenge?level=${level}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`altcha challenge failed (HTTP ${res.status})`);
    }
    const c = (await res.json()) as ChallengeResponse;

    const solution = await solveChallenge(
      c.challenge,
      c.salt,
      c.algorithm,
      c.maxnumber ?? c.maxNumber
    ).promise;

    if (!solution) {
      throw new Error("altcha solve failed");
    }

    // altcha verification payload (base64 JSON) — same shape verifySolution reads.
    return btoa(
      JSON.stringify({
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: solution.number,
        salt: c.salt,
        signature: c.signature,
      })
    );
  } finally {
    end();
  }
}
