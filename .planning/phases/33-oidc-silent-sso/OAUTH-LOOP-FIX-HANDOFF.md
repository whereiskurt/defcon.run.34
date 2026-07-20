# OAuth / Silent-SSO Redirect-Loop Fix — Session Handoff

- **Branch:** `claude/oauth-loop-mobile-h1yp12`
- **Status:** Implemented, typechecked, unit/parity tests green. **NOT deployed. No PR opened.**
- **Scope of this branch:** `run.auth` (IdP), `run.bib`, `run.flash`, `run.gpx`, `run.human`.
- **Author context:** Continues Phase 33 (`.planning/phases/33-oidc-silent-sso/`, design at
  `docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md`).

> Read this top-to-bottom before touching the auth flow. It captures the *why* so
> you don't re-derive the whole thing. The code comments carry the short version;
> this is the long version.

---

## 1. The report (symptoms)

User (Kurt) hit an intermittent auth **redirect loop**: the browser eventually shows
"too many redirects / clear your cookies." Key observations from the report:

- **"Works fine at home."** Fast connection → never reproduced there.
- **Reproduces on mobile / slow links** (reported live at a concert on a phone:
  "so slow, laggy, wouldn't load" — that lag *is* the loop, each hop being a full
  OIDC round-trip).
- **Fresh browser / no cookies / dev testing** makes it more likely.
- **"First click of the auth service on the test page is ~500–600 ms, then it
  settles."** That is the cold IdP provider `_session`; once warm the silent path
  beats the timeout window (see §3).
- User's intuition was right: common factor is **OIDC + the silent ("invisible")
  SSO**. `bib` and `flash` were the reported-broken services.

---

## 2. Architecture recap (so the loop makes sense)

Silent-SSO (Phase 33) makes an already-logged-in user's arrival at a relying party
(RP) invisible. Players:

- **IdP** = `run.auth` (`auth.defcon.run`). Runs `oidc-provider`. Holds the single
  SSO session (`_session`) and the NextAuth `sess_auth` cookie. Cookies are scoped
  `domain: .defcon.run`, so every `*.defcon.run` subdomain sees them.
- **RPs** = `run.bib`, `run.flash`, `run.gpx` (and `run.human`, the main app). Each
  is a NextAuth@5 (Auth.js) OIDC client with its own session cookie
  (`sess_bib` / `sess_flash` / `sess_gpx` / `sess_run`).
- **Silent probe** (`components/SilentSSO.tsx`, mounted app-wide in the RPs): when
  the user is `unauthenticated`, it injects a hidden 0×0 iframe pointing at
  `/api/auth/silent-signin`, which runs a `prompt=none` authorize. On success the
  iframe lands on the same-origin `/silent-callback` **bridge**, which
  `postMessage`s the parent (`success` → refresh; `login_required` → stay logged
  out). A 4.5 s timeout downgrades to a top-level redirect fallback
  (`/api/auth/auto-signin`).

**Parity constraint (still in force):** five files are authored once and kept
**byte-identical** across `gpx`/`flash`/`bib`, enforced by
`src/__tests__/silent-sso-parity.test.ts` (run.gpx is canonical). The five:
`src/lib/silent-sso.ts`, `src/app/api/auth/silent-signin/route.ts`,
`src/app/api/auth/auto-signin/route.ts`, `src/app/silent-callback/page.tsx`,
`src/components/SilentSSO.tsx`. **Any edit to these must be applied identically to
all three or the parity test fails.** (`config/auth.ts` and `app/signin/page.tsx`
are per-app and NOT parity-guarded.)

---

## 3. Root cause (the actual bug chain)

Two defects that only *combine* into a loop under slow/concurrent conditions.

### Defect A — the loop engine (deterministic once an error occurs)

- `app/signin/page.tsx` auto-fired an **interactive** `signIn()` on mount, with **no
  guard**.
- `config/auth.ts` set `pages.error = /silent-callback`, so **every** Auth.js error
  landed on the bridge.
- `app/silent-callback/page.tsx`, when loaded **top-level** (not framed), did
  `window.location.replace('/{region}/signin')`.

So any auth error produced:

```
/signin ─auto signIn()→ IdP authorize ─callback ERROR→
pages.error=/silent-callback?error=X ─(top-level bridge)→ /signin ─auto signIn()→ … ∞
```

Each hop is a full authorize round-trip → slow, and eventually
`ERR_TOO_MANY_REDIRECTS`.

### Defect B — what generates the error on slow/mobile (the trigger)

The hidden `prompt=none` iframe flow and the top-level interactive flow ran as the
**same Auth.js instance**, so they shared the OAuth **transaction cookies**
(`state_*`, `pkce`, `nonce`, `callback_*`). Auth.js keys these by fixed names.

- Fast (home): the iframe resolves in well under 4.5 s; the flows don't overlap; no
  clobber.
- Slow (mobile): the iframe outlives the 4.5 s timeout, which fires the top-level
  `auto-signin` — now **two concurrent authorize flows** write the same `state_*`
  cookie. The second overwrites the first; the earlier flow's callback fails its
  `state`/`pkce` check → Auth.js error → **feeds Defect A's loop**.

That is why it's timing-dependent ("home fine, concert broken") and why fresh
browsers (no warm `_session`, so `prompt=none` returns `login_required` slowly,
guaranteeing the timeout fires) make it worse.

### Defect C — `run.human` (separate, related)

`app/(public)/layout.tsx` redirected to `/api/auth/auto-signin` based **only** on
the `sess_auth` cookie, ignoring the `session` it already fetched — directly
contradicting its own comment ("authenticated users can stay on /"). Result: every
visit to `/` by an already-logged-in user was bounced through a full OIDC
round-trip (redundant latency), and if the freshly-set `sess_run` ever failed to
persist (slow-mobile cookie race) it became a `/ → auto-signin → OIDC → /` loop.

---

## 4. The fix (what was changed and why)

Chosen scope (Kurt): **#1 loop-breaker + #2 error-aware bridge + full anti-clobber
rework + fix run.human.**

### 4a. Full isolation — a second, dedicated Auth.js instance per RP (the anti-clobber rework)

**The core idea:** give the silent (`prompt=none`) flow its **own transaction-cookie
namespace and its own callback route**, so it can *never* share a transaction
cookie with the interactive flow. Two flows that don't share cookies can't clobber
— regardless of timing or concurrent tabs. This is stronger than serializing the
flows; it's structural.

Per RP (`bib`/`flash`/`gpx`) `config/auth.ts` now exports a **second** NextAuth
instance (`silentHandlers`, `silentSignIn`) alongside the interactive one:

- `basePath: "/api/silent-auth"` (interactive stays `/api/auth`).
- `redirectProxyUrl` = interactive's with `/api/auth` → `/api/silent-auth`.
- **Same** `sessionToken` cookie (`sess_bib` etc.), secret, providers, callbacks →
  a silent success mints an identical, interchangeable session.
- **Namespaced** transaction cookies so they can't collide with interactive:
  `state_<app>_silent`, `pkce_<app>_silent`, `nonce_<app>_silent`,
  `callback_<app>_silent`, `csrf_<app>_silent`.
- `pages.error = /silent-callback` (silent failures stay framed → bridge posts
  `login_required`).

New handler mount per app: `app/api/silent-auth/[...nextauth]/route.ts` →
`export const { GET, POST } = silentHandlers;`

The parity file `silent-signin/route.ts` now imports `silentSignIn` (as `signIn`)
from `@/config/auth` — so the probe drives the isolated instance. (Still
byte-identical across the three, since the per-app difference is entirely inside
each app's non-parity `config/auth.ts`.)

**IdP registration (required, coupled):**
`apps/run.auth/webapp/src/config/oidc.ts` now registers the silent callback URIs
for each of the `gpx`/`flash`/`bib` clients:
`https://<app>.defcon.run[/{region}]/api/silent-auth/callback/run.defcon.run`
(all regions the interactive one has: use1/cac1[/apse1], + localhost in dev). The
silent flow's `redirect_uri` **will be rejected by the IdP until this ships.**

**Why a whole second instance and not just different cookie names in one config?**
Auth.js keys transaction cookies globally per instance; a second provider entry
would still share them. Only a second instance (own basePath → own callback route →
own cookie config) truly isolates. `pkceCodeVerifier` and `nonce` are configurable
`cookies` keys in Auth.js v5, which is what makes the namespacing complete.

### 4b. `#1` — loop-breaker on `app/signin/page.tsx` (per-app)

One automatic attempt, then human-gated. On mount: read `?error=` and a
`sessionStorage` attempt marker (`dc_signin_attempt`, 15 s window). If an error is
present **or** we auto-tried within the window → render a manual **"Sign in"**
button instead of auto-redirecting. Otherwise set the marker and auto-`signIn()`
once. This converts any residual error into a single attempt + manual retry instead
of an infinite loop. (`try/catch` around `sessionStorage` for Safari private mode;
the `error` param is the hard stop even if the marker is unavailable.)

Each app keeps its own callback target and styling: bib → `/orderform`, flash →
`/`, gpx → `/studio/app`.

### 4c. `#2` — error-aware bridge `app/silent-callback/page.tsx` (parity file)

Top-level fall-through now preserves the next-auth `error` param:
`/{region}/signin?error=<type>` instead of a bare `/{region}/signin`, so the
signin guard recognises the failed attempt and shows the manual button rather than
auto-retrying into the loop. Framed behaviour (postMessage) is unchanged.

### 4d. Interactive `pages.error` → `/signin` (per-app `config/auth.ts`)

The **interactive** instance's `pages.error` changed from `/silent-callback` to
`/signin` (the loop-guarded page). Only the **silent** instance keeps
`error → /silent-callback` (framed negatives). This severs the top-level
`/silent-callback ↔ /signin` bounce.

### 4e. `run.human` fix — `app/(public)/layout.tsx`

Gated the auto-signin redirect on `!session`: it now fires only when the user has a
valid `sess_auth` but **no** run.human session yet. Authenticated users stay on `/`
(matching the intended behaviour), killing the redundant bounce and the
sess_run-doesn't-persist loop.

---

## 5. Files touched (complete list)

IdP:
- `apps/run.auth/webapp/src/config/oidc.ts` — silent callback `redirect_uris` for
  gpx/flash/bib.

Per RP (`run.bib`, `run.flash`, `run.gpx`), each identical in shape:
- `src/config/auth.ts` — interactive `pages.error → /signin`; **new** isolated
  silent NextAuth instance + `silentHandlers`/`silentSignIn` exports.
- `src/app/api/silent-auth/[...nextauth]/route.ts` — **new** silent handler mount.
- `src/app/api/auth/silent-signin/route.ts` — imports `silentSignIn` (parity).
- `src/app/silent-callback/page.tsx` — error passthrough (parity).
- `src/app/signin/page.tsx` — loop guard (per-app).

run.human:
- `apps/run.human/webapp/src/app/(public)/layout.tsx` — gate redirect on `!session`.

Two commits on the branch:
1. `fix(auth): stop OIDC silent-SSO redirect loop on slow/mobile (bib/flash/gpx)`
2. `fix(run.human): …` (this handoff's run.human change + this doc)

---

## 6. Verification done

- `tsc --noEmit` **clean** on `run.bib`, `run.flash`, `run.gpx`.
- `run.human` `tsc`: the layout change is clean; remaining tsc errors are
  **pre-existing and unrelated** (`@public/header/dcjack.svg` module-alias that
  `next build` resolves via webpack loaders but bare `tsc` can't; and ElectroDB
  `.model` type noise in `entities/__tests__/checkin.test.ts`). The repo has **no
  `typecheck` script** — it relies on `next build`, which tolerates both.
- `run.bib` vitest: **silent-sso unit + parity tests pass (33/33)**. The parity test
  reads all three apps off disk, so it validates cross-app byte-identity in one run.
- Parity md5s confirmed equal across the three for all five guarded files.
- Confirmed Next `basePath = /{REGION_SHORT}` (prod) strips the region, so
  `/{region}/api/silent-auth/...` resolves to `/api/silent-auth/...` exactly like the
  working `/api/auth/...` route.

**Not done:** no `next build`, no live/e2e run, no real mobile repro. The
`e2e/silent-sso-smoke.spec.ts` and `run.auth/e2e/tests/silent-sso.spec.ts` need live
services + acquired cookie jars (they self-skip otherwise).

---

## 7. Deployment ordering (IMPORTANT — coupled change)

The IdP registration and the RP silent flow **must ship together, IdP first-or-together**:

1. Deploy **`run.auth`** (IdP) so the new `/api/silent-auth/callback/...` URIs are
   registered. Until then any silent flow that reaches the IdP with the new
   `redirect_uri` is rejected (`redirect_uri mismatch`).
2. Deploy the three RPs (`bib`, `flash`, `gpx`). Before their silent instance code
   is live, the IdP simply has extra registered URIs that nothing uses — harmless.
3. `run.human` is independent and can ship anytime.

Release tooling: `apps/release-all.sh --parallel`, or per-app `build.sh`/`deploy.sh`.
Bump each touched app's `webapp/VERSION` per repo convention before release (not yet
done on this branch).

---

## 8. How to reproduce / test

**Local (fastest signal):**
- `cd apps/run.bib/webapp && npm i && npx vitest run src/__tests__/silent-sso-*.test.ts`
  (parity + unit).
- `npx tsc --noEmit` in bib/flash/gpx.
- Run the dev servers (see `AGENTS.md` / `.vscode/tasks.json`): run.auth :3002,
  run.bib :3004, etc. In dev there's no region prefix and `secure` cookies are off.

**Manual loop repro (before the fix, to confirm you understand it):** throttle the
network (DevTools → Slow 3G), open a fresh RP tab logged-out; the 4.5 s iframe
timeout fires the top-level `auto-signin` and, with the old shared cookies, you'd see
the `state` mismatch → `/silent-callback ↔ /signin` bounce. After the fix: the guard
shows a manual "Sign in" button; the isolated cookies prevent the clobber.

**Prod smoke after deploy:** on mobile/throttled, cold-visit `bib.defcon.run` while
logged in at `auth.defcon.run` → should land authenticated with no visible bounce
and no `?error=` on `/signin`. Watch for `state_*_silent` / `pkce_*_silent` cookies
in devtools to confirm the isolated instance is the one running the probe.

---

## 9. Open questions / follow-ups (not done)

- **SilentSSO 4.5 s timeout still escalates to a top-level interactive `auto-signin`.**
  With cookie isolation this no longer *clobbers*, but for a genuinely logged-out
  user on a slow link it can still yank them to the IdP login page (violating the
  design's "on login_required, stay logged-out" contract). Not in this branch's
  scope. Consider: on timeout just tear down and stay logged-out; escalate to
  interactive only on explicit user action. (`SilentSSO.tsx` is a parity file — edit
  all three.)
- **`run.cms` (Strapi)** was always out of silent-SSO scope; unaffected.
- **Promote the copied silent-SSO unit to a real single-source package** (Phase 33
  follow-up) — still open; the isolation change didn't touch that.
- **eslint is currently broken repo-wide** in these webapps: `npx eslint` throws
  `Converting circular structure to JSON` (flat-config + a legacy plugin) **before
  reading any file** — pre-existing, not from these changes. Lint could not be run;
  `tsc` was the gate. Worth fixing separately.
- **Auth.js `redirectProxyUrl`**: the repo (ab)uses it to force the region-prefixed
  callback; the silent instance mirrors that exactly. If someone later "cleans up"
  redirectProxyUrl, the silent callback construction must be revisited in lock-step.

---

## 10. Mental model in one paragraph (for the next session)

There are now **two Auth.js instances per RP**: interactive (`/api/auth`, cookies
`*_<app>`) and silent (`/api/silent-auth`, cookies `*_<app>_silent`), sharing only
the session cookie. The hidden `prompt=none` probe drives the *silent* instance; a
human sign-in drives the *interactive* one; they can run at the same time and never
touch each other's `state`/`pkce`/`nonce`. `/signin` auto-tries once then shows a
button; the bridge forwards errors so the button (not a loop) is what a failure
produces. `run.human` only bootstraps OIDC when it has `sess_auth` but no session of
its own. Ship `run.auth` with (or before) the RPs.
