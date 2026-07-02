# Phase 27: CMS Incognito SSO Fix - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning (needs an instrumented repro before Part B fix)
**App:** `apps/run.cms` (cms.defcon.run) — separate build/deploy from Phase 26

<domain>
## Phase Boundary

Fix the two-part auth glitch when visiting cms.defcon.run in a fresh
(incognito) browser: (A) the native Strapi login form flashes instead of
auto-redirecting to SSO, and (B) a reload lands on the branded "Access Denied"
page. Scope is `run.cms` admin bootstrap + SSO plugin + cookie/session config
only. No changes to run.human.

</domain>

<decisions>
## Implementation Decisions

### Part A — Native login shown on cold incognito load (CONFIRMED root cause)
- **File:** `apps/run.cms/app/src/admin/app.tsx`. The auto-redirect guard
  `shouldRedirectToSSO()` runs **once at module-load** and only matches when the
  path already `includes('/admin/auth/login')`. A cold incognito hit lands on
  `/{region}/admin`, then Strapi's SPA client-side-routes to the login page
  **without a full reload**, so the guard never re-fires → native Strapi login
  form is shown. Only a hard reload (URL already `.../auth/login`) triggers SSO.
- **Fix direction:** make the redirect fire on SPA navigation to the login
  route, not just at module load — e.g. hook it in `bootstrap()` and/or watch
  for history/route changes to `/admin/auth/login`, or intercept the login-page
  render. Keep the existing "hide documentElement to prevent flash" guard.

### Part B — "Access Denied" on reload (needs repro to confirm which cause)
- **Symptom source:** branded "Access Denied" is emitted at
  `strapi-server.ts:172` when `userData.services` lacks `'cms'`; the
  `services-validation.ts` middleware also returns 401 "Access denied" on admin
  routes. Two candidate causes to disambiguate with an instrumented repro:
  1. **Cookie/state drop (most likely a bug):** OIDC `oidcState`/`codeVerifier`
     live in the koa session cookie; refresh token cookie is set
     `secure:false` + `sameSite:'lax'` (`REFRESH_COOKIE_OPTIONS`). Cross-site
     incognito round-trip from auth.defcon.run can drop the state/session cookie
     → 401 → access-denied on reload. Revisit `sameSite`/`secure` for the OIDC
     session + refresh cookies (TLS terminates at edge, so `secure` needs care).
  2. **Genuinely-missing `cms` service claim:** the account simply lacks `cms`
     in the OIDC userinfo `services`. If so this is expected, not a bug — but
     verify the `services` scope/claim is actually delivered (log
     `userData.services` in the callback).
- **Fix ships after repro** identifies (1) vs (2). Instrument first, then fix.

### Verification
- Incognito cold load of cms.defcon.run → redirects straight to SSO, no native
  login flash (Part A). After valid SSO login with `cms` service → lands in
  admin panel, reload stays authenticated, no access-denied (Part B).
- Test both region prefixes (`/use1/admin`, `/cac1/admin`) since nginx rewrites
  `/{region}/strapi-plugin-sso/*` → `/strapi-plugin-sso/*`.

</decisions>

<specifics>
## Specific Ideas
- Related infra note: `reference_klanker_token_mint` — token mint filtering can
  drop granted permissions; if the `services` claim itself looks wrong at the
  auth layer, cross-check whether it's an OIDC delivery issue vs. a real
  missing-service before touching cms code.
- Keep the fix minimal and inside `app.tsx` + cookie options; avoid forking the
  strapi-plugin-sso beyond the existing `strapi-server.ts` override.

</specifics>

<code_context>
## Existing Code Insights
- `apps/run.cms/app/src/admin/app.tsx` — module-load `shouldRedirectToSSO()`
  guard (Part A); `bootstrap()` fetch-interceptor already handles 401→SSO and
  logout→OIDC end_session (good hook point for Part A fix).
- `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts` —
  `oidcSignInCallback`; "Access Denied" at services-claim check (line ~172);
  `REFRESH_COOKIE_OPTIONS` (secure:false, sameSite:lax); sets access token into
  localStorage via nonce'd inline script + refresh token httpOnly cookie.
- `apps/run.cms/app/src/middlewares/services-validation.ts` — admin-route 401
  "Access denied" when live services lacks `cms`; 5-min validation cache.
- `apps/run.cms/app/config/plugins.ts` — SSO OIDC config, `OIDC_REDIRECT_URI`.
- `apps/run.cms/nginx/` — rewrites `/{region}/strapi-plugin-sso/*` and blocks
  register-admin; relevant to region-prefix path handling.

</code_context>

<deferred>
## Deferred Ideas
- Broader session-lifetime / silent-refresh UX (5–10 min sessions force
  frequent OIDC re-auth) → revisit if re-auth churn is annoying in practice.

</deferred>

---
*Phase: 27-cms-incognito-sso-fix*
*Context gathered: 2026-07-02*
