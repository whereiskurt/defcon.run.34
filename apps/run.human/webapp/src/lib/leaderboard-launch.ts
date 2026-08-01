/**
 * The leaderboard launch switch.
 *
 * ONE constant, read in exactly two places:
 *   1. `/whoami` — whether the "Leaderboard" button renders at all,
 *   2. `GET /api/leaderboard/me` — whether a non-admin caller gets their row
 *      or a bare 404.
 *
 * The effective gate at both sites is `LEADERBOARD_SELF_ENABLED || isAdmin`.
 * Until launch, only admin/runadmin members see the button or reach the route;
 * everyone else cannot tell the surface exists (non-disclosure, the same
 * posture as the hidden full board at `/leaderboard`).
 *
 * ── Flipping it ────────────────────────────────────────────────────────────
 * Set to `true` and release run.human. That single edit opens "Your standing"
 * — the caller's OWN row only — to every signed-in runner. It does NOT open
 * the full multi-runner board: `/leaderboard` and `GET /api/leaderboard` keep
 * their independent admin gate, and `/api/leaderboard/me` never accepts a
 * userId param, so a runner can only ever see themselves.
 */
export const LEADERBOARD_SELF_ENABLED = false;
