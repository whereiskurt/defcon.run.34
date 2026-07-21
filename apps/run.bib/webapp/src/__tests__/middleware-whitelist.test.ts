import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guard for the middleware auth-gate whitelist.
 *
 * The middleware wraps Auth.js and reads env at module load, so it is not
 * practical to unit-test its runtime behaviour here. Instead — in the same
 * spirit as the silent-SSO parity test — assert the SOURCE keeps every path
 * that must stay reachable WITHOUT a session. Each entry below exists
 * because gating it breaks a cookieless caller:
 *
 *   /api/health            — ALB health checks (no cookies ever)
 *   /api/stripe/webhook    — Stripe servers (HMAC-verified, no cookies)
 *   /api/checkout/general  — cross-origin donate: the CORS preflight OPTIONS
 *                            carries no cookies BY SPEC; a 307 to /signin
 *                            makes browsers reject the preflight and the
 *                            donate modal fails with "Failed to fetch"
 *                            (regression guard for that exact prod bug)
 *   /api/silent-auth/*     — silent-SSO instance; its callback MINTS the session
 *   /silent-callback       — silent-SSO iframe bridge page
 *   /api/auth/*            — Auth.js interactive handlers
 *   /signin, /access-denied — the login flow itself
 */

const middlewareSource = readFileSync(
  join(__dirname, "..", "middleware.ts"),
  "utf8",
);

// The whitelist is the boolean expression assigned to `isWhitelisted`.
const whitelistExpr = middlewareSource.match(
  /const isWhitelisted =([\s\S]*?);/,
)?.[1];

describe("middleware auth-gate whitelist keeps cookieless-caller paths open", () => {
  it("has an isWhitelisted expression to inspect", () => {
    expect(whitelistExpr).toBeTruthy();
  });

  it.each([
    ['relPath === "/signin"'],
    ['relPath === "/access-denied"'],
    ['relPath === "/silent-callback"'],
    ['relPath.startsWith("/api/auth/")'],
    ['relPath.startsWith("/api/silent-auth/")'],
    ['relPath === "/api/health"'],
    ['relPath === "/api/stripe/webhook"'],
    ['relPath === "/api/checkout/general"'],
  ])("whitelists %s", (clause) => {
    expect(whitelistExpr).toContain(clause);
  });
});
