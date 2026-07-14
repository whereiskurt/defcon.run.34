/**
 * Pure leaderboard UI seams (LDBR-10, Phase 52).
 *
 * Two tiny, side-effect-free functions that back the `LeaderboardTable`
 * accordion so the presentation logic is unit-testable WITHOUT a canvas or the
 * DOM (mirrors the Phase 49-51 pure-seam convention). No React, no JSX — just
 * data in, data out.
 *
 *   - runnerClassEmoji: mqttUsertype → the runner-class emoji rendered after a
 *     display name.
 *   - deriveCountChips: a leaderboard row's activity/CTF counts → the small
 *     typed chip array the accordion title renders (activity green, ctf orange).
 */

import type { RunUserItem } from "@/entities/run-user";

/** The runner class enum, reused from the entity so callers pass rows uncast. */
type RunnerClass = RunUserItem["mqttUsertype"];

/**
 * Runner-class emoji, appended after a display name in the board.
 *
 * DC33 parity: wildhare → ⭐️, og → 🤠 (the two Kurt's original board mapped).
 * DC34 extension (documented choices): rabbit → 🐇 (the default runner class,
 * the site's bunny mascot) and admin → 🛡️ (an admin/steward shield). Any
 * undefined/unknown value degrades to '' so a plain runner shows no trailing
 * emoji (SC #4 — no stray glyph).
 */
export function runnerClassEmoji(mqttUsertype?: RunnerClass): string {
  switch (mqttUsertype) {
    case "wildhare":
      return "⭐️";
    case "og":
      return "🤠";
    case "rabbit":
      return "🐇";
    case "admin":
      return "🛡️";
    default:
      return "";
  }
}

/** HeroUI semantic color for each derived count chip. */
export type CountChipColor = "success" | "warning";

/** One derived count chip: activity (green) or CTF (orange). */
export type CountChip = {
  key: "activity" | "ctf";
  count: number;
  color: CountChipColor;
};

/** The subset of a leaderboard row `deriveCountChips` reads. */
type CountChipSource = {
  activityCounts?: { checkin?: number; gpx?: number };
  ctfSolves?: number;
};

/**
 * Derive the two title chips for a leaderboard row.
 *
 * activity = (checkin ?? 0) + (gpx ?? 0) → green/success chip.
 * ctf = ctfSolves ?? 0 → orange/warning chip. `ctfSolves` may be 0/absent until
 * the CTF judge ships, so both chips render 0 gracefully (never undefined/NaN —
 * SC #4). Always returns exactly [activity, ctf] in that order so the caller can
 * render a stable chip row.
 */
export function deriveCountChips(row: CountChipSource): CountChip[] {
  const activity = (row.activityCounts?.checkin ?? 0) + (row.activityCounts?.gpx ?? 0);
  const ctf = row.ctfSolves ?? 0;
  return [
    { key: "activity", count: activity, color: "success" },
    { key: "ctf", count: ctf, color: "warning" },
  ];
}
