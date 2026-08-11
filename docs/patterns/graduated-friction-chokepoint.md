# Graduated-friction chokepoint

**A server-to-server auth flow has no per-entry-point UI moment to challenge a user —
but every real login funnels through exactly one renderable chokepoint. Inject the
anti-abuse challenge there, gate it with a short-TTL signed proof-of-clearance
cookie, and dial its difficulty per-user as a graduated punishment instead of a
binary block.**

## Context

You bolt an anti-abuse challenge (a proof-of-work CAPTCHA, a rate gate, a human
check) onto one login path — say the email/magic-link flow — and it works. Then you
notice the *other* login paths sail straight past it: the social/OAuth providers hand
off server-to-server and never render a widget, so an attacker just creates accounts
through those instead. The challenge you built is a fence with a gate held open next
to it.

The instinct is to add the challenge to each provider path too. But those paths have
no UI seam to render into — they are redirects between servers. And even if you could,
you'd now be maintaining the same anti-abuse logic at N entry points, each a chance to
drift or leave a gap. You want to enforce *once*, somewhere every login must pass,
and you want the option to make that friction *worse* for specific bad actors without
blocking legitimate users outright.

## Forces

- **Federated login has no mid-flow render.** An OAuth/OIDC roundtrip is
  `signIn(provider) → provider → callback`. There is nowhere to inject a widget
  between those hops; the flow is redirects, not pages.
- **A blocking callback can reject but not challenge.** The hook that runs for every
  provider can *return false* to deny a login, but it cannot *render* a puzzle and
  wait for a solution.
- **N entry points means N chances to miss one.** Every place you enforce is code you
  must keep correct as providers are added. The bypass you shipped happened precisely
  because enforcement lived at *one* entry point and a second one existed.
- **Binary block is a blunt instrument.** For a user you *suspect* but haven't
  confirmed is abusive, an outright ban is too much and doing nothing is too little.
  You want a middle setting: let them in, but make it progressively, deliberately
  annoying.
- **The clearance proof must not become a standing bypass.** Whatever token says "this
  login already cleared the challenge" has to be un-forgeable, un-replayable, and
  short-lived — or it's just a skeleton key.

## The pattern

Find the **one renderable chokepoint** every real login funnels through — the point
after authentication where the browser lands in a page-rendering context before the
session is finalized (in OIDC terms, the interaction step). Inject the cross-cutting
challenge *there*, once, instead of at every entry point.

```
   email login ─┐
   OAuth login ─┼──▶  THE ONE CHOKEPOINT  ──▶ session finalized
   social login ┘     (interaction step)
                            │
              ┌─────────────┴──────────────┐
        valid proof-of-clearance      no proof
        cookie for this subject?          │
              │ yes                        ▼
              ▼                    redirect to challenge;
        clear it, proceed         require N solves at
                                  difficulty D; on success
                                  set proof cookie; return
```

**Gate with a proof-of-clearance cookie.** A short-TTL, subject-bound, signed cookie
proves the current login already cleared its challenge. Properties that make it safe:

- **Signed with a server secret** (HMAC), verified server-side, never trusted
  unsigned. Reuse an existing internal secret so you add no new key to manage.
- **Bound to the subject** (`sub`) so it cannot be replayed across users.
- **Short TTL** — long enough to finish the interaction, short enough that it never
  persists as a standing bypass. It clears *one pending login*, not a session.
- **Fails closed if the signing key is missing.** An empty/unset key must make *every*
  token fail verification — never pass. A misconfigured deploy should over-challenge,
  never silently disable the gate.
- **Backed by an in-memory replay guard** that records used solutions by hash with a
  TTL, prunes expired entries opportunistically, and **hard-caps eviction** so a burst
  of distinct payloads can't exhaust memory (evict oldest past the ceiling).

**Dial difficulty per user as graduated punishment.** Layer a per-user "jail" level on
top of the baseline. An admin-dialed level (say 1–5) raises **both** knobs at once:
the proof-of-work difficulty *and* the number of solves required. Friction becomes a
punitive dial, not an on/off switch:

- Clean users get an optional light baseline (one solve) or nothing at all, behind a
  single enforcement toggle so you can dial the universal friction to zero if it
  annoys real people.
- A flagged user faces more solves at higher difficulty — login still works, but it's
  slow and irritating, calibrated to the suspicion level.
- The level→(count, difficulty) tables live in **one place** so tuning is a
  single-file edit.

Keep the requirement computation a **pure function** of the user's profile and the
enforcement toggle — trivial to unit-test across every level and the disabled case.

**Sibling pattern — per-action proof-of-work for individual mutations.** The same
building blocks (an HMAC-signed challenge, difficulty as a search-space size, a
fail-closed key check) also work *inline* on a single mutating request that does have
a UI moment: issue a signed challenge, have the browser solve it, verify before
applying the write. Tune difficulty per action by the search-space bound (a heavier
"save" vs a lighter "toggle"). Reuse an existing internal secret so there's no new key
management, and reject the mutation if no key is configured.

## Key moves

- **Enforce at the confluence, not the tributaries.** One universal chokepoint that
  every login must cross beats N per-entry-point checks — it closes the whole class of
  "you forgot to fence path X" bypass at once.
- **Difficulty is a dial, not a switch.** Encode punishment as *graduated* friction
  (more solves × harder puzzles) so you have a response between "ignore" and "ban."
- **The clearance cookie is stateless and self-defending.** Signed + subject-bound +
  short-TTL + fail-closed means the gate needs no server-side session store to be safe,
  and a config slip errs toward *more* friction.
- **Reuse an existing secret.** Signing the clearance cookie (and per-action
  challenges) with a secret you already provision avoids new SSM params, IAM, and
  rotation choreography.
- **Cap the replay guard's memory.** An in-memory dedup map must prune by TTL *and*
  hard-cap eviction, or a flood of unique payloads becomes a memory-exhaustion vector.
- **Keep the requirement math pure.** A `requirement(profile) → {count, difficulty}`
  function with no I/O is the testable heart of the whole gate.

## Traps

- **Exempt the flows that legitimately can't render.** A silent, no-UI login (session
  reuse / `prompt=none`) *must* skip the challenge or it breaks — you can't render a
  puzzle into a flow whose entire point is rendering nothing. Detect "fresh
  interactive login" vs "silent reuse" and gate only the former.
- **Don't double-challenge.** If one entry path (e.g. email) already challenged before
  the chokepoint, reconcile so it isn't challenged again at the chokepoint — either
  skip it or treat it as already-cleared. Two puzzles for one login trains users to
  hate you.
- **In-memory replay guard is per-instance.** Across a multi-instance deployment the
  guard only dedups within one process; a solution replayed against a different
  instance slips through. Acceptable as a first cut, but name it — a shared/distributed
  guard is the hardening follow-up.
- **A punitive level that doesn't bite immediately feels broken.** If raising a user's
  level should annoy them *now*, you must also invalidate their warm session so their
  next request re-runs the challenged login — otherwise a user on a warm session sails
  past the new friction until it lapses.
- **Fail-open on the signing key is a silent hole.** The single most important line is
  the one that makes an empty key reject everything. Get it wrong and a misconfigured
  environment disables the whole gate with no error.

## When not to use it

- If there is genuinely only one login path and it already has a UI seam, challenge it
  there directly — the chokepoint indirection buys nothing.
- If you never need a middle response between allow and block, skip the graduated dial
  and keep a single baseline (or a hard block list); the level tables are overhead you
  won't use.
- If your anti-abuse need is a hard *rate* limit rather than a *human/effort* proof, a
  counter at the edge is a better tool than a proof-of-work challenge.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-12-altcha-oauth-jail-design.md` —
  the OAuth bypass, the OIDC-interaction chokepoint, the `altcha_ok` clearance cookie,
  the `challengeRequirement` pure function, and the admin-toggled jail level.
- **Gate primitives:** `apps/run.auth/webapp/src/lib/altcha-gate.ts` —
  `challengeRequirement` (level→count/difficulty tables in one place), `signPayload`/
  `verifyPayload` (HMAC, fail-closed on empty key), the `altcha_ok`/`altcha_progress`
  cookies, and `markSolutionUsed` (TTL prune + `MAX_USED_SOLUTIONS` hard-cap eviction).
- **Baseline toggle:** `ALTCHA_OAUTH_ENFORCED`, documented in `.claude/architecture.md`.
- **Sibling (per-action PoW):** `apps/run.bib/webapp/src/lib/altcha.ts` — self-hosted
  proof-of-work on bib mutations, difficulty tuned per action via `maxNumber`, signing
  key reused from `AUTH_INTERNAL_SECRET`, fail-closed when unconfigured.
- Realized with the `altcha-lib` proof-of-work primitives, an `oidc-provider` identity
  service, and a per-user jail level stored on the auth profile.
