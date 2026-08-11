# Cross-app SSO cookie umbrella

**Scope session cookies to the registrable parent domain (`.example.com`) instead of
a single host, so every subdomain and the apex are literally the *same site* — then
one signed-in state, one silent-SSO iframe, and one auth challenge cover every
property you run, with full OIDC semantics intact.**

## Context

You run a family of web properties on subdomains of one domain: an app, an auth
service, an editor, a landing page, an admin tool. They should feel like *one*
product — sign in once and you are signed in everywhere; a link from any property
credits the same account; a static marketing page can quietly tell whether the
visitor is logged in and greet them by name.

The naive setup gives each host its own session cookie scoped to that exact host.
Now every property is an island. A user logged in at `app.example.com` visiting
`editor.example.com` gets bounced through a full, *visible* login redirect. A static
page can't tell who the visitor is without its own auth stack. And every relying
party re-runs the whole interactive authorization from scratch.

The thing that fixes all of this is not a framework or a broker feature. It is a
single line in how you set the cookie.

## Forces

- **Browsers gate cookies by *site*, not by host.** A modern browser decides whether
  to attach a cookie to a cross-context request using the *registrable domain* (the
  "site") and the cookie's `SameSite` policy — not the exact hostname. Two
  subdomains of one registrable domain are the same site; two different registrable
  domains are not.
- **`SameSite=Lax` is the safe default you actually want.** It blocks the dangerous
  case (a *cross-site* POST forging a request with your cookie) while still sending
  the cookie on top-level navigations and same-site subresource loads. But "cross
  site" is judged by registrable domain — so whether Lax helps or hurts you is
  decided entirely by how you scoped the cookie.
- **Server-to-server auth flows have no UI seam.** An OIDC/OAuth authorization is a
  chain of redirects. There is no natural place to say "you're already logged in,
  skip the page" *unless* the cookie that proves it rides along on those redirects.
- **Silent means the top page must not unload.** "Log in without the user noticing"
  is only silent if the page they're looking at never navigates away. That forces
  the check into a hidden frame — which only works if cookies flow into the frame.

## The pattern

Set every session cookie with `Domain=.example.com` (the registrable parent), not
the host. That one decision makes the apex and every subdomain a single site.
`SameSite=Lax` cookies then ride along on cross-subdomain top-level requests,
same-site subresource loads, and same-site iframes. Three capabilities fall out of
that primitive — none of them need shared secrets.

```
                    ONE cookie umbrella: Domain=.example.com
      ┌──────────────┬───────────────┬───────────────┬──────────────┐
   apex landing   app.        editor.        auth. (IdP)      admin.
      │              │              │              │              │
      └──────── the same registrable site; SameSite=Lax rides between them ───┘

   (A) credit from anywhere     (B) silent SSO           (C) one challenge point
   a subresource fired from     hidden 0×0 iframe runs   the single rendered
   the static apex ships the    prompt=none authorize;   interaction covers every
   session cookie → server      bridge postMessages      relying party at once
   knows who you are            success/login_required
```

**(A) Credit a signed-in user from any property.** Because the cookie is presented to
every subdomain *and* the apex, any page under the umbrella — even a fully static
landing page firing a single subresource request — ships the session cookie to your
server. The server reads it and knows the visitor's identity with zero client auth
code on that page. `HttpOnly` is irrelevant here (the *server* reads the cookie); the
page never sees it.

**(B) Silent SSO in a hidden iframe.** When a relying party loads for an
unauthenticated-looking visitor, it renders its page immediately and runs the SSO
check in a hidden 0×0 iframe so the top page never unloads:

1. The iframe points at an authorize request with `prompt=none` (the OIDC flag for
   "complete only if a session already exists; otherwise fail, don't prompt").
2. Because the frame is same-site, the identity provider's session cookie flows into
   it. If a session exists, the grant completes and the frame lands on a small
   *same-origin bridge page*.
3. The bridge `postMessage`s `success` or `login_required` to the parent (targeting
   the explicit parent origin, never `*`; the parent verifies `event.origin`). On
   success the parent refreshes into the authenticated view; on `login_required` it
   stays logged-out. No top-level navigation either way.
4. A timeout arms a fallback: if no message arrives (a hung network or a frame-block
   on some intermediate response), tear down the iframe and downgrade to an
   *invisible* top-level redirect.

**(C) One challenge point for every relying party.** Make the identity provider's
interaction URL point at a **server route that reads the existing session and
completes the grant with no HTML render** — the completion logic already existed; it
was just being reached *after* a needless page render. Now an already-signed-in user
completes the authorization invisibly, and a genuinely-logged-out user still reaches
the real login page. Auto-consent is bounded by an allowlist of your own first-party
clients, so a new property joins the silent flow without ever rendering a consent
screen, while an unknown client gets no automatic grant.

Full OIDC semantics survive all three: authorization-code flow, PKCE, per-client
tokens, and consent are unchanged. Nothing shares a secret — relying parties still
learn identity only through the front-channel code flow.

## Key moves

- **The cookie scope is the whole trick.** One character — the leading dot on the
  domain — converts N isolated hosts into one site. Everything else (cross-property
  crediting, silent frames, single challenge point) is a *consequence* of that, not
  separate machinery.
- **Complete the grant server-side, render nothing.** The interaction URL should
  resolve to a route that reads the session and finishes — reserve HTML rendering for
  the truly-logged-out case. A rendered "checking…" page is the difference between
  invisible and visibly bouncing.
- **`prompt=none` in a hidden frame, not a redirect.** A redirect unloads the page; a
  frame does not. The frame is what makes the check *silent* rather than merely fast.
- **The bridge page is the only thing that talks to the parent.** Normalize every
  negative OIDC outcome (`login_required`, `consent_required`, …) to one
  `login_required`-class message so the parent never has to reason about OIDC errors.
- **Auto-consent only your own allowlist.** Silent SSO across first-party properties
  is safe *because* the auto-grant is bounded to clients you registered. Never
  auto-consent an arbitrary client id.
- **Timeout down to an invisible redirect.** The frame is the fast path; a top-level
  redirect through the (now render-free) interaction route is the safety net for the
  cases a frame can't cover.

## Traps

- **The coupling is load-bearing and invisible.** Every one of these capabilities
  depends on all properties sharing the *same registrable domain*. Move one service
  to a different domain and silent SSO stops receiving the session cookie, the static
  page stops knowing who the visitor is, and the single challenge point fragments —
  with no compile error to warn you. Write this coupling down.
- **`SameSite=None` is not the answer.** Reaching for `None` to "make cookies work
  cross-site" widens your CSRF surface and requires `Secure`; the umbrella makes the
  requests *same-site* so `Lax` just works. If you find yourself wanting `None`,
  you've probably split your registrable domains.
- **`postMessage` to `*` leaks.** The bridge must target the explicit parent origin,
  and the parent must verify `event.origin`. A wildcard turns your silent-SSO frame
  into a message oracle for any page that frames it.
- **A persistent IdP session is a shared-computer tradeoff.** Making the provider's
  SSO session `remember`-persistent (so it survives browser restarts) extends how
  long "signed in everywhere" lasts. Ensure logout clears *both* the provider session
  and the underlying auth session.
- **Frame blocks on intermediate renders.** If any step in the authorize chain
  renders framed HTML, a `frame-ancestors`/`X-Frame-Options` policy can silently kill
  the frame. The happy path renders nothing, so this only bites on the fallback edge
  — which is exactly why the timeout fallback must exist.

## When not to use it

- If your properties live on genuinely different registrable domains (distinct brands
  on distinct TLDs), the browser will not treat them as one site and none of this
  applies — you need a cross-site broker with its own tradeoffs.
- If you have exactly one host, there is nothing to unify; a host-scoped cookie is
  simpler and slightly tighter.
- If a property must *not* share sign-in state with the others (a deliberately
  separate trust zone), keep its cookie host-scoped on purpose — the umbrella is all
  or nothing within the domain.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md` — the
  full silent-SSO design: server-route interaction URL, hidden-iframe `prompt=none`,
  the same-origin bridge page, and the timeout→redirect fallback. The
  cookie-umbrella insight is also called out as load-bearing in
  `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §2
  (crediting a signed-in user from any `defcon.run` property, including the static
  apex).
- **Auto-consent allowlist:** `apps/run.auth/webapp/src/config/load-existing-grant.ts`
  (custom `loadExistingGrant` that auto-consents only the registered first-party
  clients), wired in `apps/run.auth/webapp/src/config/oidc.ts`.
- **Silent-SSO e2e:** `apps/run.auth/e2e/tests/silent-sso.spec.ts`.
- Realized on session cookies scoped `Domain=.defcon.run`, an `oidc-provider` identity
  service, and NextAuth relying parties across `run.`, `gpx.`, `bib.`, and the apex.
