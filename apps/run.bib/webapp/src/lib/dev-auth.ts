import type { Session } from "next-auth";

import type { BibItem } from "@/entities/bib";

/**
 * Dev-only auth bypass for local UI iteration.
 *
 * When active, the whole app renders against a synthetic session + bib so
 * you can style orderform / BibForm / BibPreview / SponsorForm / the sponsor
 * instruction pages WITHOUT standing up the run.auth OIDC service or a local
 * DynamoDB. This is the fast inner loop for pure visual work.
 *
 * DOUBLE-GATED so it can never activate in a deployed build:
 *   1. NODE_ENV must NOT be "production" — Next sets this on `next build` /
 *      `next start` and in the ECS image, so a production artifact can never
 *      honor the flag regardless of what env is passed, AND
 *   2. DEV_AUTH_BYPASS must be exactly "1".
 *
 * Enable locally:
 *   DEV_AUTH_BYPASS=1 npm run dev          # or: npm run dev:ui
 *
 * Everything else (Stripe checkout, the reconcile Lambda, admin reports)
 * still hits the real backends — this only fakes the session + bib read so
 * pages paint. Live-save (PATCH /api/bib) is stubbed to a no-op 200 so the
 * BibForm "saved" state works without a database.
 */
export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_BYPASS === "1"
  );
}

/** Stable synthetic OIDC subject used by the mock session + bib. */
export const DEV_MOCK_USER_ID = "dev-local-user";

/**
 * Session-shaped mock. `services` carries a claim so any downstream claim
 * check passes; `id` is what the server components read (session.user.id).
 */
export const DEV_MOCK_SESSION = {
  user: {
    id: DEV_MOCK_USER_ID,
    name: "Local Dev",
    email: "dev@localhost",
    services: ["bib"],
  },
  expires: "2999-01-01T00:00:00.000Z",
} as unknown as Session;

/**
 * BibItem-shaped mock — fully populated so orderform / sponsor pages render
 * the same shapes they would with a real DynamoDB row. `nameOnBib` is
 * pre-filled so BibPreview shows text on first paint.
 */
export function devMockBib(overrides: Partial<BibItem> = {}): BibItem {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    ownerSub: DEV_MOCK_USER_ID,
    nameOnBib: "LOCAL DEV",
    runnerCode: "BIB-DEV0",
    paidAmount: 0,
    paidStatusHistory: [],
    nameLocked: false,
    willPayInPerson: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as BibItem;
}
