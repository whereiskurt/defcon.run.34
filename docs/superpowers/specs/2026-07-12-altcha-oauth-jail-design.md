# Altcha-on-OAuth Enforcement + Jail — Design

**Date:** 2026-07-12
**Service:** run.auth (`auth.defcon.run`)
**Status:** Approved (design shape + `altcha_ok` cookie mechanism) — proceeding to implementation plan

## Problem

Today Altcha (proof-of-work CAPTCHA) is enforced in exactly **one place**: the
custom `/api/login` route that fronts the email/magic-link flow. OAuth logins
(GitHub / Discord / LinkedIn) call `signIn('github')` straight into Auth.js and
**never touch Altcha** — so an attacker can create accounts rapidly via OAuth,
bypassing the challenge entirely.

We want two things:

1. **Baseline:** every OAuth login must solve **one** Altcha to complete —
   bringing OAuth to parity with the email flow and closing the bypass.
2. **Jail:** a per-user, admin-toggled punitive mode. A jailed user faces
   **extra** Altcha friction on login — `jailLevel` (1–5) dials **both** the
   proof-of-work difficulty *and* the number of solves required. Sticky until an
   admin releases them from the identity dashboard (PR #542). The intent is to
   make login progressively annoying for users flagged as abusive.

## Constraints Discovered

- **OAuth has no UI moment.** The OAuth roundtrip is a server-to-server redirect
  (`signIn('github')` → provider → `/api/auth/callback/{provider}`); we cannot
  render a widget mid-flow.
- **The one renderable chokepoint** every real login funnels through is the OIDC
  interaction: `/login?oidc={uid}` → `/api/oidc/interaction/[uid].ts`. After a
  fresh authentication (OAuth *or* email) the browser lands here in a renderable
  context before the OIDC grant completes. This is where the challenge is
  injected.
- **The `signIn` callback** (`config/auth.ts`) runs for every provider and can
  *block* (return false) but cannot *render* a challenge.
- **Altcha primitives already exist:** `createChallenge({ hmacKey, maxNumber,
  expires })` (`/api/captcha/challenge`), `verifySolution(payload, hmacKey,
  true)` (used in `/api/login`), the `altcha` web-component widget, and an
  in-memory replay guard (`markChallengeUsed`, per-process only).
- **AuthProfile** already carries `lockedOut` / `lockoutReason` / `lockedAt` /
  `sessionVersion`. No `jailed` flag yet.
- **Silent SSO (`prompt=none`)** reuses an existing run.auth session and cannot
  render UI — it must be exempt from the challenge or it breaks.

## Architecture

### The `altcha_ok` gate (approved mechanism)

A short-lived **signed cookie `altcha_ok`** proves the current login has cleared
its Altcha requirement. It is HMAC-signed with a server secret and bound to the
authenticated subject, with a short TTL (~10 min — long enough to finish the
interaction, short enough to not persist as a standing bypass).

**Payload (signed):** `{ sub, iat, exp }` — `sub` binds it to one identity so it
can't be replayed across users. Signed with a new `ALTCHA_GATE_SECRET` (or reuse
`ALTCHA_HMAC_KEY`). Verified server-side; never trusted unsigned.

### Flow at the OIDC interaction chokepoint

`/api/oidc/interaction/[uid].ts`, after reading the authenticated `sess_auth`
JWT and **before** `oidc.interactionResult(...)` completes the grant:

```
1. Load the interaction. Determine if this is a FRESH interactive login
   (the user just authenticated) vs a silent-SSO/session-reuse.
      - Silent SSO (prompt=none / no fresh login) → EXEMPT: proceed as today.
2. Compute the challenge requirement for this subject:
      profile = getAuthProfile(sub)
      required = challengeRequirement(profile)   // {count, difficulty} — see below
      if required.count === 0 → proceed as today (enforcement disabled).
3. If a valid `altcha_ok` cookie for this sub exists → clear it, proceed
   (complete interactionResult, redirect back to RP).
4. Else → redirect to `/challenge?oidc={uid}` (do NOT complete the grant yet).
```

### The challenge page + verify endpoint

- **`/challenge` (new client page)** — renders the `altcha` widget. Reads the
  required `count` and per-solve `difficulty` from a small server-provided config
  (the challenge endpoint issues challenges at the right `maxNumber`). Tracks
  progress ("2 of 5 solved") for jailed users. Region-prefixed like the login
  page.
- **`/api/captcha/challenge`** — extended to accept a `difficulty` derived
  server-side from the caller's profile (NOT a client-supplied number — the
  client cannot pick its own easy difficulty). It maps `jailLevel → maxNumber`.
- **`/api/captcha/verify-login` (new)** — verifies each solution
  (`verifySolution` + replay guard), increments a per-login solved counter
  (signed cookie `altcha_progress`), and once `solved >= required.count`, sets
  the `altcha_ok` cookie and returns "done" so the page redirects back to
  `/api/oidc/interaction/{uid}`.

### Requirement function (pure, testable)

```
challengeRequirement(profile) -> { count: number, difficulty: number }

  baseEnforced = env ALTCHA_OAUTH_ENFORCED === "true"   // universal baseline toggle
  jailed       = profile?.jailed === true
  level        = clamp(profile?.jailLevel ?? 0, 0, 5)

  if (!jailed && !baseEnforced) return { count: 0, difficulty: 0 }   // no challenge
  if (!jailed)                  return { count: 1, difficulty: BASE_MAXNUMBER }

  // jailed: level dials BOTH count and difficulty
  return {
    count:      COUNT_BY_LEVEL[level],        // e.g. 1→2, 2→3, 3→4, 4→6, 5→8
    difficulty: DIFFICULTY_BY_LEVEL[level],   // maxNumber, e.g. 1→200k … 5→8M
  }
```

Baseline "everyone, once" is gated behind `ALTCHA_OAUTH_ENFORCED` so the
universal friction can be toggled off (keeping jail-only) if it annoys real
users. Level tables are constants, tunable in one place.

### Jail data + admin control

New `AuthProfile` attributes alongside the lockout fields:

- `jailed: boolean` (default false)
- `jailLevel: number` (1–5; meaningful only when jailed)
- `jailReason: string` (admin note)
- `jailedAt: number`

**Admin toggle** — a new action in the **PR #542 identity drawer**, mirroring the
lock/unlink routes:

- `POST /api/admin/identities/[userId]/jail` — body `{ jailed: boolean, level?: 1..5, reason?: string }`.
  - Jail: set `jailed=true`, `jailLevel=level`, `jailReason`, `jailedAt`, **and
    bump `sessionVersion`** so the user's current session dies immediately →
    their next request forces an interactive re-login straight into the challenge
    wall (annoyance starts the instant you toggle).
  - Release: set `jailed=false`, clear `jailLevel`/`jailReason`/`jailedAt` (leave
    `sessionVersion` bumped, matching the unlock convention).
- Session-gated + in-process revalidation + 404-on-deny (identical to the
  existing admin routes). Manual body validation (no zod), `process.env.AUTH_INTERNAL_SECRET`
  not involved (this is session-gated).
- The identity list/drawer surfaces a `JAILED L{n}` badge next to `LOCKED`, and a
  `jailed` filter pill.

### Why jailing bumps sessionVersion (and silent SSO stays safe)

Jailing bumps `sessionVersion` → the user's existing session is invalidated
downstream (the session-validate path already enforces this). Their next silent
SSO fails → forces an interactive re-login → hits the `/challenge` gate. So
jailed users are challenged even though silent SSO itself renders no UI, and
non-jailed users' silent SSO is untouched.

## Scope

**In:**
- `altcha_ok` gate at the OIDC interaction chokepoint (covers all SSO/RP logins).
- `/challenge` page + `/api/captcha/verify-login` + `difficulty`-aware challenge issuance.
- `challengeRequirement` pure function + level tables.
- `jailed`/`jailLevel`/`jailReason`/`jailedAt` on AuthProfile.
- `POST .../[userId]/jail` admin route + drawer action + badge + filter pill (extends PR #542 surface).
- `ALTCHA_OAUTH_ENFORCED` baseline toggle.

**Out (deliberate):**
- **Direct, non-SSO run.auth page logins** (a rare path that doesn't pass the
  OIDC interaction) — v1 gates the interaction chokepoint only. A run.auth-wide
  middleware gate is a possible follow-up. `log()` this gap.
- **Distributed replay protection.** The existing replay guard is in-memory
  per-process (weak across multi-instance ECS). Moving used-challenge tracking to
  DynamoDB is a hardening follow-up, not v1.
- **Auto-expiring or self-serve-parole jail** — v1 jail is admin-only sticky
  (chosen). The level tables leave room to add these later.

## Tradeoffs / Risks

- **Baseline friction:** "everyone, once" adds an Altcha step to *every* OAuth
  login for *every* user, forever. Mitigated by the `ALTCHA_OAUTH_ENFORCED`
  toggle so it can be dialled to jail-only.
- **Interaction-route complexity:** the gate adds a branch to a security-critical
  OIDC route; must not break the exempt silent-SSO path or leave a login half-
  completed. Needs careful testing of: fresh OAuth login (challenged), fresh
  email login (already challenged at /api/login — must not double-challenge —
  reconcile so email logins either skip the gate or are considered already
  cleared), silent SSO (exempt), jailed user (escalated), released user.
- **`altcha_ok` cookie theft:** short TTL + sub-binding + signature limit blast
  radius; it only clears the challenge for one pending login, not a session.

## Key Files

- `src/pages/api/oidc/interaction/[uid].ts` — inject the gate here
- `src/app/api/captcha/challenge/route.ts` — add server-derived `difficulty`
- `src/app/api/captcha/verify-login/route.ts` — NEW verify + progress + set cookie
- `src/app/(authlogin)/challenge/page.tsx` — NEW challenge UI (or under a suitable group)
- `src/lib/altcha-gate.ts` — NEW pure `challengeRequirement` + cookie sign/verify
- `src/entities/auth-profile.ts` — add jail fields
- `src/app/api/admin/identities/[userId]/jail/route.ts` — NEW admin route
- `src/app/admin/AdminActions.tsx` / `AdminConsole.tsx` — jail action + badge + pill (PR #542 files)
- `src/config/auth.ts` — the email `/api/login` reconciliation (avoid double-challenge)
