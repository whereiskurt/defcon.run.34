# Phase 33: OIDC Silent SSO - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md)

<domain>
## Phase Boundary

Make the OIDC redirect flow **invisible** for an already-authenticated user, and
let a relying party obtain an authorization code **silently** once the user is
logged in anywhere under `*.defcon.run` — while preserving full OIDC semantics
(authorization code, PKCE, per-client id_token, consent). Approach A (invisible
front-channel bridge); NOT the shared-cookie/back-channel Approach B.

**In scope:**
- `apps/run.auth` (IdP) — three changes to the oidc-provider integration.
- A hidden-iframe `prompt=none` silent-SSO client unit, authored once and wired
  identically into the three full-user NextAuth RPs: `run.gpx`, `run.flash`,
  `run.bib`.

**Explicitly out of scope (deferred):**
- `run.cms` (Strapi, admin-only users) — needs a non-NextAuth adaptation.
- Approach B (shared `AUTH_JWT_SECRET` + private-DNS back-channel).
- Monorepo/workspace build infra for a true single-source package.
- RP session TTL harmonization.
</domain>

<decisions>
## Implementation Decisions

Everything below is a LOCKED decision from the approved design spec.

### IdP — run.auth/webapp/src/config/oidc.ts
- Repoint `interactions.url` from the client login page
  (`${config.urls.loginPage}?oidc=${uid}`) to the **server** interaction route
  `/{region}/api/oidc/interaction/{uid}`. Authenticated users complete the
  interaction server-side with no HTML render; the route already falls back to
  `/{region}/login?oidc={uid}` when `sess_auth` is absent.
- Add a **custom `loadExistingGrant(ctx)`**: when `ctx.oidc.account` is set AND
  `ctx.oidc.client.clientId` is one of the registered first-party clients
  (allowlist already in oidc.ts: runHuman, cmsStrapi, gpxStudio, flashTool, bib),
  return the existing grant for that client if present, else mint one covering the
  requested scopes and record it on the session (`session.grantIdFor`). For any
  unknown client, return `undefined` (default behavior — no auto-consent).

### IdP — run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts
- Change the `login` result's `remember: false` → `remember: true` so the
  provider `_session` persists (15-day `Session` TTL). Apply to all result
  branches that set `login` (login prompt + unknown-prompt fallback).

### RP silent-SSO client unit (authored once; placed in gpx, flash, bib)
- Hidden `<iframe>` (0×0, `aria-hidden`) on public routes points at an app
  initiator route that triggers `prompt=none`:
  `signIn("run.defcon.run", { redirectTo: "/{region}/silent-callback" }, { prompt: "none" })`
  (third `signIn` arg passes `prompt=none` to the authorization request).
- A same-origin `/silent-callback` bridge page calls
  `window.parent.postMessage({ type: "silent-sso", status }, <app-origin>)` with
  `status: "success" | "login_required"`. `postMessage` targets the explicit app
  origin (never `*`); the parent listener verifies `event.origin` before acting.
- Parent behavior: `success` → refresh to authenticated view; `login_required` →
  stay logged-out (no auto-redirect).
- **Timeout (~4–5s):** if no `postMessage` arrives, tear down the iframe and
  downgrade to a redirect-based auto-signin fallback route (modeled on
  run.human's `src/app/api/auth/auto-signin/route.ts`), which is invisible thanks
  to the IdP change.
- Every `prompt=none` negative response (`login_required`, `interaction_required`,
  `consent_required`, `access_denied`) reaching the callback is normalized by the
  bridge to a `login_required`-class message; NextAuth's default callback error
  redirect is routed to the bridge so it stays inside the iframe.
- App-specifics (region, client id, callback path, app origin) are parameterized;
  the unit contains no app-specific logic (trivially extractable later).

### Shared delivery (prototype constraint — LOCKED)
- The repo has no cross-webapp code-sharing infra (no workspaces; per-app
  `@/* → ./src/*`; independent Docker build contexts). For this prototype the
  unit is authored once and placed **identically** in each app's `src/`, guarded
  by a **parity test** asserting the copies stay in sync. True single-source
  packaging is a follow-up.

### Claude's Discretion
- Exact file paths/names within each app's `src/` for the initiator route,
  `/silent-callback` bridge page, iframe client component/hook, and fallback route.
- The parity-test mechanism (byte-compare copies vs. import-from-single-source).
- Iframe transport details (component mount point on public routes; timeout value
  within the ~4–5s target).
- Test file locations per each app's existing conventions.

### Testing (LOCKED intent; mechanics at discretion)
- IdP unit: `loadExistingGrant` auto-consents a first-party client, returns
  `undefined` for unknown client, reuses an existing grant.
- IdP integration: (i) `prompt=none` + live provider session → 302 with `code`, no
  interaction; (ii) `prompt=none` + no session → `login_required`; (iii)
  `interactions.url` resolves to the interaction route; (iv) authenticated
  interaction completes without rendering `/login`; (v) unauthenticated still
  reaches `/login`.
- RP unit: bridge maps success/negatives to the right `postMessage`; parent acts
  only on same-origin messages; timeout arms the fallback. Parity test across the
  three copies.
- e2e (Playwright): warm-session visit to an RP — top-level URL never changes, no
  login page renders, app session cookie set via iframe, authenticated view shown.
  Logged-out: iframe posts `login_required`, parent stays logged-out, no loop.
  Full e2e on gpx; smoke on flash and bib.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract (authoritative)
- `docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md` — the full approved
  design: mechanism, component changes, data flow, error handling, security,
  testing, follow-ups.

### IdP files to modify
- `apps/run.auth/webapp/src/config/oidc.ts` — oidc-provider config: current
  `interactions.url`, client allowlist, cookies, ttl, `findAccount`. Add custom
  `loadExistingGrant`.
- `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` — server
  interaction completion (reads `sess_auth` via `getToken`, creates grant,
  `interactionResult`). Flip `remember`.
- `apps/run.auth/webapp/src/config/index.ts` — `urls.loginPage`, region/routePrefix.

### RP reference + targets
- `apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts` — reference
  server-side `signIn` route to model the redirect fallback on.
- `apps/run.gpx/webapp/src/config/auth.ts` — RP NextAuth OIDC provider config
  (issuer, endpoints, checks, session cookie) — pattern for flash/bib.
- `apps/run.flash/webapp/`, `apps/run.bib/webapp/` — additional NextAuth RP targets
  (same stack: Next.js 16 + next-auth@5 beta).

### Library
- `oidc-provider@9.6.0` — `loadExistingGrant(ctx)` is a supported config hook;
  `setProviderSession` is NOT available in v9 (session is established only via
  the interaction result, which is why `remember:true` + the invisible bridge are
  the mechanism).
</canonical_refs>

<specifics>
## Specific Ideas

- All session cookies use `domain: .defcon.run`; `auth.defcon.run` and the RP
  subdomains are same-site (registrable domain `defcon.run`), so `SameSite=Lax`
  cookies (`sess_auth`, provider `_session`) flow inside the iframe — this is what
  makes the silent check work without third-party-cookie relaxation.
- First-party client allowlist lives in `oidc.ts` clients block; reuse it for
  `loadExistingGrant` rather than a second list.
- `remember:true` extends the IdP SSO session to ~15 days (accepted tradeoff);
  existing `rpInitiatedLogout` clears both provider `_session` and `sess_auth`.
- Related existing roadmap item: Phase 27 "CMS Incognito SSO Fix" (v1.6) — same
  problem space, different app; keep terminology consistent.
</specifics>

<deferred>
## Deferred Ideas

- `run.cms` (Strapi) silent SSO — admin-only; users-permissions OIDC adaptation.
- Promote the copied silent-SSO unit to a true single-source package.
- Approach B (shared-cookie + private-DNS back-channel).
- Harmonize RP session TTLs (`sess_gpx`/`sess_run` = 1 day vs IdP 15 days).
</deferred>

---

*Phase: 33-oidc-silent-sso*
*Context gathered: 2026-07-03 via PRD Express Path*
