# Phase 7: Branded Login - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the bare placeholder HTML at cms.defcon.run root with a DCR34-branded landing page that has a single sign-in button triggering the OIDC flow, and provide branded error pages for SSO failures including access denied. The existing OIDC SSO flow (strapi-plugin-sso + app.tsx auto-redirect) already works and is NOT being changed.

</domain>

<decisions>
## Implementation Decisions

### Visual design
- Match auth.defcon.run's visual style: dark theme, glass-card centered layout, Las Vegas background images, teal accents, font-museo wordmark
- Static HTML file served by nginx (replace existing `apps/run.cms/nginx/index.html`) — zero dependency on Strapi being up, fast, always works
- CSS embedded/inline in the HTML file
- Background images: reuse the existing Vegas background set from run.auth (`vegas-z9.png` through `vegas-z12.png`)

### Heading and copy
- Claude's discretion on exact heading text (could be `defcon.run CMS`, `cms.defcon.run`, or variation)
- Claude's discretion on logo treatment (text wordmark only vs adding a logo image)
- Subtitle: Claude's discretion (e.g., "Content Management System" or "Event Organizer Portal")

### Login interaction
- Button text: "Sign in with defcon.run" — clear SSO messaging
- Button links directly to the Strapi SSO endpoint (`/{region}/strapi-plugin-sso/oidc`) — skips loading Strapi admin JS, fewer redirects
- Always show the sign-in button regardless of auth state — static page has no session awareness
- Region prefix handling: detect from URL path like existing nginx patterns (e.g., `/use1/` prefix)

### Error/denied experience
- All SSO errors get branded pages — not just access denied, but token failures and network errors too
- Branded error pages use the same visual style as the login page (glass-card, Vegas background)
- Access denied message: "You don't have permission to access the CMS. Contact an event organizer to request access." (or Claude's refinement)
- Claude's discretion on error page actions (back link, try different account, etc.)

### Claude's Discretion
- Exact heading text and wordmark treatment
- Subtitle/tagline copy
- Logo image vs text-only wordmark
- Error page action buttons (back to login, try different account)
- Error copy for non-denial errors (token failures, etc.)
- How to override the SSO plugin's `renderSignUpError` to use branded HTML
- Background image selection and sizing

</decisions>

<specifics>
## Specific Ideas

- "I want it to feel like auth.defcon.run — same brand, same vibe, just the CMS version"
- The sign-in button should go directly to the SSO OIDC endpoint, not through the Strapi admin panel
- The access denied page should be clear and not alarming — it's a small organizer team, mistakes happen

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/run.auth/webapp/public/bg/vegas-z9.png` through `vegas-z12.png` — Las Vegas background images used by auth.defcon.run login
- `apps/run.auth/webapp/src/app/(authlogin)/login/page.tsx` — Reference implementation for DCR34 visual style (glass-card, font-museo, teal-dot, animate-fade-up)
- `apps/run.cms/nginx/index.html` — Current placeholder to replace (10 lines of bare HTML)
- `apps/run.cms/nginx/nginx.conf` — Region prefix routing patterns for `/{region}/admin`, `/{region}/strapi-plugin-sso/*`

### Established Patterns
- Region detection: `window.location.pathname.match(/^\/([a-z]{3}\d)/)` pattern used in `app.tsx`
- SSO endpoint: `/{region}/strapi-plugin-sso/oidc` — nginx rewrites to `/strapi-plugin-sso/oidc`
- Error rendering: `oauthService.renderSignUpError(message)` in strapi-plugin-sso extension — returns raw HTML
- Security: nginx blocks `/admin/auth/register-admin` and `/admin/register` routes

### Integration Points
- nginx `index.html` → served when no other route matches OR for domain root
- `strapi-plugin-sso/strapi-server.ts` → `oauthService.renderSignUpError()` for error pages
- `app.tsx` → existing auto-redirect on `/admin/auth/login` to SSO (should NOT change)
- CloudFront routes `/{region}/*` to regional ALB → nginx → Strapi

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-branded-login*
*Context gathered: 2026-03-02*
