# OIDC Silent SSO — Invisible Interaction Bridge + Cross-RP `prompt=none`

- **Date:** 2026-07-03
- **Branch:** `feat/oidc-silent-sso`
- **Status:** Design — approved, pending spec review
- **Scope:** `apps/run.auth` (IdP) + a silent-SSO client wired into the three
  full-user NextAuth RPs: `run.gpx`, `run.flash`, `run.bib`. Prototype.
- **Explicitly deferred:** `run.cms` (Strapi, admin-only users — not worth the
  separate non-NextAuth adaptation for this prototype).

## Problem

A user who is already logged in at `auth.defcon.run` still experiences visible
"bouncing" — rendered pages and multiple navigations — when their browser is
sent through the OIDC authorization flow, both when signing in via
`run.defcon.run` and when later visiting `gpx.defcon.run`.

Root cause is two-fold:

1. **The IdP forces a rendered interaction.** `oidc-provider`'s
   `interactions.url` points at the **client** `/login` page. Even when a valid
   `sess_auth` NextAuth session exists, the browser fully loads that page, does a
   client-side `/api/auth/session` fetch, then JS-navigates onward. The
   server-side completion route (`interaction/[uid].ts`) that reads `sess_auth`
   and finishes the interaction already exists — it is simply reached *after* an
   unnecessary page render.
2. **No cross-RP SSO fast path.** Each relying party (RP) keeps its own session
   (`sess_gpx`, `sess_run`, …). There is no `prompt=none` silent check, so a
   globally-logged-in user visiting a new RP re-runs a full interactive
   authorize. The IdP's provider `_session` is also transient
   (`remember: false`), so it does not persist across browser restarts.

All session cookies are scoped to `domain: .defcon.run`, so `sess_auth` is
already presented to every `*.defcon.run` subdomain.

## Goal

Make the redirect flow **invisible** for an already-authenticated user, and let a
second RP obtain a code **silently** once the user is logged in anywhere — while
preserving full OIDC semantics (authorization code, PKCE, per-client id_token,
consent). No new secrets shared to RPs.

Non-goals (explicit): changing the RP↔IdP back-channel trust model (Approach B,
shared `AUTH_JWT_SECRET`), TTL harmonization across apps, the `run.cms` (Strapi)
adaptation, and introducing monorepo/workspace build infrastructure for a
truly-single-source package. Those are tracked as follow-ups, not part of this
prototype.

## Mechanism / Mental Model

The IdP has a single SSO session: the `oidc-provider` `_session` cookie. Today it
is transient and only created via a rendered login page. We make it:

- **(a) created invisibly** from the already-present `sess_auth` (server-side
  interaction completion, no HTML render),
- **(b) persistent** (`remember: true`), and
- **(c) auto-consenting** for our own first-party clients (custom
  `loadExistingGrant`).

Once that SSO session exists, any other first-party RP can obtain a code via
`prompt=none` with zero visible navigation.

## Component Changes

### run.auth (IdP)

**1. `src/config/oidc.ts` — `interactions.url` targets the server route.**
Return the server interaction-completion route instead of the client login page:

```
// before: `${config.urls.loginPage}?oidc=${interaction.uid}`
// after:  `${interactionRoute(region)}/${interaction.uid}`  ->  /{region}/api/oidc/interaction/{uid}
```

The interaction route (`src/pages/api/oidc/interaction/[uid].ts`) already:
- reads `sess_auth` via `getToken`,
- if authenticated → creates/uses a grant and calls `oidc.interactionResult(...)`,
- if **not** authenticated → redirects to `/{region}/login?oidc={uid}`.

Effect: an authenticated user completes the interaction server-side with **no
page render**; an unauthenticated user still reaches the real `/login`.

**2. `src/config/oidc.ts` — custom `loadExistingGrant(ctx)` (auto-consent
first-party clients).**
The default implementation only finds a grant already recorded for that client
in the session, so a *new* RP (e.g. gpx) would still trigger a consent prompt and
`prompt=none` would fail with `consent_required`. Custom implementation:

- If `ctx.oidc.account` is set **and** `ctx.oidc.client.clientId` is one of the
  registered first-party clients (the allowlist already declared in `oidc.ts`:
  runHuman, cmsStrapi, gpxStudio, flashTool, bib), return the existing grant for
  that client if present, otherwise mint one covering the requested scopes and
  record it on the session (`session.grantIdFor`).
- Otherwise return `undefined` (fall back to default behavior — no auto-consent).

This is what lets a first-party RP's `prompt=none` succeed without that RP ever
having rendered a consent page.

**3. `src/pages/api/oidc/interaction/[uid].ts` — `remember: true`.**
Change the `login` result's `remember: false` → `remember: true` so the provider
`_session` persists (15-day `Session` TTL) rather than being tied to the browser
session. Applies to all three result branches (`login`, unknown-prompt, and the
login part).

### NextAuth RPs — gpx, flash, bib

**4. Hidden-iframe silent-SSO check on public routes (primary mechanism).**
Authored once as a small self-contained client unit and mounted in each of the
three NextAuth apps. On an unauthenticated request, the app renders its page and
performs the SSO check in a **hidden iframe** so the top-level page never unloads:

- A hidden `<iframe>` (0×0, `aria-hidden`) points at the app's initiator route
  that triggers a `prompt=none` authorize:
  `signIn("run.defcon.run", { redirectTo: "/{region}/silent-callback" }, { prompt: "none" })`
  — the third `signIn` argument passes `prompt=none` through to the authorization
  request.
- The whole authorize → RP callback → landing sequence runs **inside the iframe**.
  On success the callback sets the app's session cookie (e.g. `sess_gpx`; cookie
  `domain: .defcon.run`, so the parent frame immediately has it) and the iframe
  lands on a small same-origin **`/silent-callback` bridge page**.
- The bridge page calls `window.parent.postMessage({ type: "silent-sso", status }, origin)`
  with `status: "success" | "login_required"`. The parent listener (scoped to the
  app's own origin) reacts: on `success`, refresh to the authenticated view; on
  `login_required`, remain in the logged-out view (no auto-redirect).

**Why the iframe works here (same-site):** `auth.defcon.run` and
`gpx.defcon.run` share the registrable domain `defcon.run`, so an iframe from gpx
to auth is a **same-site** context. `SameSite=Lax` cookies — `sess_auth` and the
provider `_session` — are therefore sent inside the iframe, which is exactly what
makes the silent check possible without third-party-cookie relaxation.

**Fallback:** a redirect-based auto-signin route (modeled on run.human's existing
`src/app/api/auth/auto-signin/route.ts`, invisible thanks to change #1) is
retained for the timeout / unexpected-render case (see Error Handling). It is the
safety net, not the primary path.

Contract: *attempt silent in the iframe; on `login_required` stay logged-out; on
timeout downgrade to the invisible redirect; never render a login page unless the
user is truly logged out.*

**5. Shared module delivery (prototype constraint).**
The repo has **no cross-webapp code-sharing infrastructure**: no npm/yarn
workspaces, each webapp is self-contained with a per-app `@/* → ./src/*` alias,
and each builds in its own independent Docker context that cannot reach outside
its directory (the meshtk pattern clones a *separate service repo* into the build
context — it is not a TS-source share between webapps). Introducing workspaces or
a build-time copy pipeline is a meaningful infra side-quest, out of proportion to
this prototype.

Therefore, for the prototype, the silent-SSO client is **authored once as a
canonical, self-contained unit and placed identically** in each of the three
apps' `src/` (works with the existing `@/*` alias, zero build changes). Drift is
guarded by a **parity test** that asserts the three copies are byte-identical (or
imported from a single checked-in source of truth). Promoting this to a true
single-source package (workspace or build-time copy, meshtk-style) is a named
follow-up — the module is authored to be trivially extractable when that happens
(no app-specific logic inside it; all app specifics — region, client id, callback
paths — passed in as parameters/config).

## Data Flow — warm user visits a cold RP (`gpx`/`flash`/`bib`)

Identical for all three apps (`gpx.defcon.run` used as the example). Top-level
page loads immediately; the hidden iframe drives the check.

1. **Provider `_session` exists** (user logged in earlier via run):
   iframe `prompt=none` → account known → custom `loadExistingGrant` auto-consents
   gpx → code returned silently → iframe callback sets `sess_gpx` → bridge posts
   `success` → parent refreshes to authenticated view. **No top-level navigation.**
2. **No provider session yet, but `sess_auth` present** (edge case — user has a
   NextAuth session at the IdP but the SSO `_session` was never created, e.g.
   first RP after a provider-session expiry):
   iframe `prompt=none` → `login_required` (prompt=none cannot create a session) →
   bridge posts `login_required`. Parent then triggers the **redirect fallback**
   (auto-signin), whose interaction route reads `sess_auth`, completes
   **invisibly** (change #1), and `remember:true` re-establishes the SSO session →
   `sess_gpx` set. This one edge case incurs a single invisible top-level redirect;
   subsequent visits are fully silent.
3. **No `sess_auth` at all:**
   iframe `prompt=none` → `login_required` → parent stays in logged-out view; if
   the user then acts to sign in, the redirect flow reaches the real `/login`.
   Correct: user is genuinely logged out.

## Error Handling

- **Iframe timeout:** the parent arms a timeout (target ~4–5s) when injecting the
  iframe. If no `postMessage` arrives (hung network, an unexpected framed render,
  or a `frame-ancestors`/`X-Frame-Options` block on some intermediate response),
  the parent tears down the iframe and downgrades to the redirect fallback — the
  user is never left waiting on a silent frame.
- Every `prompt=none` negative response (`login_required`,
  `interaction_required`, `consent_required`, `access_denied`) that reaches the RP
  callback is normalized by the bridge page to a `login_required`-class
  `postMessage`; the parent never surfaces an OIDC error to the user. NextAuth's
  default error redirect for the callback is routed to the same bridge page so it
  stays inside the iframe.
- `loadExistingGrant` auto-consents **only** the hardcoded first-party allowlist;
  any unknown `client_id` receives no auto-grant.
- Existing `interactionDetails` / expired-interaction / `isSessionNotFound`
  handling in `[uid].ts` is preserved unchanged.

## Security Considerations

- **`remember: true` extends the IdP SSO session to ~15 days** (the `Session`
  TTL). Shared/public-computer implication accepted as a deliberate tradeoff. The
  existing `rpInitiatedLogout` flow clears both the provider `_session` and
  `sess_auth`, so logout remains complete.
- **No secret sharing.** `AUTH_JWT_SECRET` stays on the IdP only; RPs continue to
  learn identity through the front-channel OIDC code flow. (This is the explicit
  reason Approach A was chosen over the back-channel Approach B.)
- **Auto-consent is allowlist-bounded.** Only the first-party clients already
  registered in `oidc.ts` are auto-consented; the mechanism cannot silently
  grant an unknown/newly-registered client.
- **PKCE and per-client id_token semantics are unchanged** — this only removes
  interaction *rendering* and adds silent grant resolution, not any token-shape
  change.
- **Framing / `postMessage` hygiene.** The silent flow only frames the IdP's
  redirect responses (no HTML render on the happy path), and the RP callback +
  bridge page are same-origin to gpx, so existing `frame-ancestors` /
  `X-Frame-Options` policy is not expected to change. If any intermediate response
  *does* render framed HTML, the timeout fallback covers it. The bridge page's
  `postMessage` MUST target the explicit gpx origin (not `*`), and the parent
  listener MUST verify `event.origin` before acting.
- **Iframe reachability depends on same-site subdomains.** Because all apps sit
  under `defcon.run`, `SameSite=Lax` cookies flow into the iframe. If a service is
  ever moved to a different registrable domain, the silent iframe stops receiving
  `sess_auth` and would need a different transport — noted so the coupling is
  explicit.

## Testing Strategy

TDD each change. Layers:

- **IdP unit** — `loadExistingGrant`: auto-consents a first-party client (mints +
  records grant), returns `undefined` for an unknown client, reuses an existing
  grant when present.
- **IdP integration** —
  (i) `prompt=none` + live provider session → 302 with `code`, no interaction;
  (ii) `prompt=none` + no session → `login_required`;
  (iii) `interactions.url` now resolves to the interaction route;
  (iv) authenticated interaction completes without rendering `/login`;
  (v) unauthenticated interaction still reaches `/login`.
- **RP client unit** — bridge page maps callback success → `success` and each
  negative `prompt=none` outcome → `login_required` `postMessage`; parent listener
  acts only on messages from the app's own origin; timeout arms the redirect
  fallback. Plus a **parity test** that the gpx/flash/bib copies are in sync.
- **e2e (Playwright)** — warm-session visit to the RP: top-level URL never
  changes, no login page renders, the app's session cookie is set via the iframe,
  and the authenticated view appears. Logged-out visit: iframe posts
  `login_required`, parent stays logged-out, no redirect loop. Full e2e on gpx;
  smoke-level on flash and bib (same unit, parameterized).

## Files Touched

- `apps/run.auth/webapp/src/config/oidc.ts` — `interactions.url`, custom
  `loadExistingGrant`.
- `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` — `remember: true`.
- **Silent-SSO client unit** (authored once) — an initiator route that calls
  `signIn(..., { prompt: "none" })`, a same-origin `/silent-callback` bridge page
  (`postMessage`), a client component/hook that injects the hidden iframe + parent
  listener + timeout on public routes, and a redirect-based auto-signin fallback
  route (mirroring run.human). All app specifics (region, client id, callback
  path) parameterized. Placed identically in:
  - `apps/run.gpx/webapp/src/...`
  - `apps/run.flash/webapp/src/...`
  - `apps/run.bib/webapp/src/...`
- Parity test asserting the three copies stay in sync (single source of truth).
- Tests colocated per each app's existing test conventions.
- Exact paths within each `src/` determined in the plan.

## Follow-ups (out of scope)

- **`run.cms` (Strapi)** silent SSO — admin-only users; needs a users-permissions
  OIDC-provider adaptation of the iframe pattern (concept ports, code does not).
  The IdP-side changes already make its redirect-through-auth invisible.
- Promote the copied silent-SSO unit to a **true single-source package**
  (workspace or meshtk-style build-time copy) once the prototype proves out.
- Evaluate Approach B (shared-cookie + private-DNS back-channel) if zero-redirect
  matters more than OIDC purity.
- Harmonize RP session TTLs (`sess_gpx`/`sess_run` = 1 day vs IdP 15 days).
