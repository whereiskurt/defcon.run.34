# OIDC Silent SSO — Invisible Interaction Bridge + Cross-RP `prompt=none`

- **Date:** 2026-07-03
- **Branch:** `feat/oidc-silent-sso`
- **Status:** Design — approved, pending spec review
- **Scope:** `apps/run.auth` (IdP) + `apps/run.gpx` (RP). Prototype.

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
shared `AUTH_JWT_SECRET`), TTL harmonization across apps, and extracting a shared
auth package. Those are tracked as follow-ups, not part of this prototype.

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

### run.gpx (RP)

**4. Silent-SSO pre-check on public routes.**
On an unauthenticated request, gpx first attempts a hidden `prompt=none`
authorize before any interactive flow:

- **Success** → establish `sess_gpx` with no top-level navigation.
- **`login_required` / `interaction_required` / `consent_required`** → fall back
  to the redirect-based auto-signin route (modeled on run.human's existing
  `src/app/api/auth/auto-signin/route.ts`), which is now itself invisible thanks
  to change #1.

The exact hidden-check transport (hidden iframe + `postMessage`, vs. a
fetch-based check) is an implementation detail to be settled in the plan; the
contract is: *attempt silent, downgrade to invisible redirect, never show a login
page unless truly logged out.*

## Data Flow — warm user visits `gpx.defcon.run` cold

1. **Provider `_session` exists** (user logged in earlier via run):
   gpx `prompt=none` → account known → custom `loadExistingGrant` auto-consents
   gpx → **code returned silently, no page unload** → `sess_gpx` set.
2. **No provider session yet, but `sess_auth` present:**
   `prompt=none` → `login_required` → gpx redirect auto-signin → interaction
   route reads `sess_auth`, completes **invisibly** (change #1),
   `remember:true` establishes the SSO session → `sess_gpx` set. No login page.
3. **No `sess_auth` at all:**
   interaction route → real `/login`. Correct: user is genuinely logged out.

## Error Handling

- Every `prompt=none` negative response (`login_required`,
  `interaction_required`, `consent_required`, `access_denied`) is caught and
  downgraded to the interactive/redirect fallback — never surfaced as an error.
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
- **RP (gpx)** — silent pre-check establishes `sess_gpx` on success; each
  negative `prompt=none` outcome downgrades to the invisible redirect fallback.
- **e2e (Playwright)** — warm-session visit to `gpx.defcon.run` renders no login
  page and performs no visible navigation.

## Files Touched

- `apps/run.auth/webapp/src/config/oidc.ts` — `interactions.url`, custom
  `loadExistingGrant`.
- `apps/run.auth/webapp/src/pages/api/oidc/interaction/[uid].ts` — `remember: true`.
- `apps/run.gpx/webapp/src/...` — silent-SSO pre-check + redirect fallback route
  (exact paths determined in the plan).
- Tests colocated per each app's existing test conventions.

## Follow-ups (out of scope)

- Evaluate Approach B (shared-cookie + private-DNS back-channel) if zero-redirect
  matters more than OIDC purity.
- Harmonize RP session TTLs (`sess_gpx`/`sess_run` = 1 day vs IdP 15 days).
- Extract a shared auth package so RP config cannot drift.
