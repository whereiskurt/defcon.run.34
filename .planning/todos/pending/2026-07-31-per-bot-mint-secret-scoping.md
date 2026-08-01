---
created: 2026-07-31T00:40:00Z
title: "ctf mint: one shared internal secret authorises minting a claim link for ANY flag"
area: run.human
priority: medium
source: 72-10 / docs/superpowers/specs/2026-07-31-bot-hardening-design.md "Out of scope (deliberate)"
---

Raised during Phase 72 design and **consciously deferred by Kurt**. Recorded so the
acceptance is visible rather than forgotten.

## What

The single-use award mint endpoint authorises callers with **one shared secret**, and that
secret carries no per-bot scope:

- `apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts:108-109` — the whole
  authorisation check is a constant comparison of the `x-internal-secret` request header
  against `config.auth.internalSecret`. Pass it and you may mint for whichever ghost the
  request body names; there is nothing tying a holder of the secret to a particular bot.
- `route.ts:137-156` — the route then derives the flag code server-side from
  `MESHTK_GHOST_KEY_SECRET` + `ghost.id` + `ghost.flagCode`. Good (the code never travels),
  but the *choice of ghost* is caller-supplied and unconstrained by the credential.

## The blast radius is the whole bot fleet

All eight personas share one value. From
`infra/terraform/live/site/services/run.mqtt/service.hcl:368-373`:

```
MESHTK_INTERNAL_SECRET -> /{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret
```

That is the **same SSM parameter run.human reads as `AUTH_INTERNAL_SECRET`** — so the
credential is shared not just across bots but across services. Anything that can read it
(or any leak from the ghosts container) can mint a valid single-use claim link for any
flag, which is exactly the "genuinely single-use" property Phase 72 was built to establish.

## Why it was acceptable to ship

The secret is a `SecureString` delivered by `valueFrom`, never in terraform plan output and
never logged, and the ghosts container is not internet-reachable. The exposure requires
already having a foothold. It is a defence-in-depth gap, not a live hole — which is why it
was deferred rather than blocking the release.

## Where a future session should start

1. `apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts:108-109` — the check to
   replace. Simplest credible shape: per-bot secrets keyed by ghost id, so a credential can
   only mint for its own persona.
2. `infra/terraform/live/site/services/run.mqtt/service.hcl:363-401` — the `secrets` block
   where per-bot params would be declared; note the ordering comment at 393-398 (ECS refuses
   to START a task whose `valueFrom` parameter does not exist, so the `secrets` apply must
   land before the `ecs-task` apply — the same staging Phase 72 used).
3. `apps/run.human/webapp/src/app/api/internal/ctf/mint/__tests__/route.test.ts` — existing
   coverage to extend with a wrong-bot-secret rejection case.

Splitting the parameter also decouples the bots from `AUTH_INTERNAL_SECRET`, which is worth
doing on its own.

## ⭐ VERIFIED SCOPE CORRECTION (2026-08-01) — it is shared across SEVEN services

This todo originally described the secret as shared between run.mqtt and run.human. Grepping
every live service definition shows `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret`
is consumed by **all seven**:

| service | service.hcl line |
|---|---|
| run.auth | 267 |
| run.bib | 173 |
| run.gpx | 193 |
| run.flash | 163 |
| run.human | 178 (as `AUTH_INTERNAL_SECRET`) |
| run.cms | 249 |
| run.mqtt | 372 (as `MESHTK_INTERNAL_SECRET`) |

So the credential that authorises `POST /api/internal/ctf/mint` — which can mint a claim link
for **any** challenge, since the `ghost`/`challenge` field is caller-supplied and unconstrained
by the credential — is the same value held by seven separate containers. A foothold in ANY of
them (cms, bib, gpx, flash, auth …) is sufficient to mint arbitrary CTF flag claims, not just a
foothold in the bot fleet.

That widens the blast radius argument but does NOT change the deferral decision: still a
SecureString, still not internet-reachable, still needs a prior foothold. It does raise the
priority from `medium` toward the top of that band, and it means the fix is really two changes:
(a) scope the mint credential per bot, and (b) stop seven services sharing one internal secret.
