---
created: 2026-07-31T00:40:00Z
title: "meshtk bots are single-region (use1 only) — cac1 not deployed"
area: infra
priority: low
source: 72-10 / docs/superpowers/specs/2026-07-31-bot-hardening-design.md "Out of scope (deliberate)"
---

Raised during Phase 72 design and **consciously deferred by Kurt**. The bots — ghosts,
ricky, the whole persona fleet, and everything Phase 72 shipped (single-use award mint,
fail-closed guardrails, the lyric semaphore) — run in **us-east-1 only**.

## Why it is not merely "not done yet"

`infra/terraform/live/site/site.hcl:8`:

```
skip_regions = ["ap-southeast-1", "ca-central-1"]
```

cac1 is explicitly skipped at the site level, so this is not a matter of re-running an
apply against another region — the region is switched off for the whole site config. Any
past release note saying "cac1 NOT deployed" for mesh work traces back to this line.

## What would have to move

1. **`site.hcl:8`** — drop `ca-central-1` from `skip_regions`, or arrange a per-service
   exception. This is the gating change; nothing else matters until it lands.
2. **The ghosts container env** —
   `infra/terraform/live/site/services/run.mqtt/service.hcl:340-401`. The `environment` and
   `secrets` blocks are already region-templated (`{{REGION_LABEL}}`), so they parameterise
   cleanly, but every referenced SSM parameter must exist **in cac1 before the ecs-task
   apply**: ECS hard-fails task START on a missing `valueFrom` (the ordering comment at
   `service.hcl:393-398` spells this out — it is what blocked 72-08).
3. **The mint-failure fallback secret** —
   `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ricky-fallback-url`
   (`service.hcl:399`). Currently seeded for use1 only. cac1 needs its own value seeded
   through SOPS -> `terragrunt-apply.yml -f modules=secrets` (**dispatched from `main`** —
   the `terraform-apply` environment's deployment-branch policy allows only `main`, and
   `workflow_dispatch` has no `ref` input; 72-08 lost time to exactly this).
   Same for `ghosts-password`, `ghost-key-secret`, `ghost-start-delay`, `flag-challenges`
   and `jwt/internal_secret`.

## Also think about before doing it

Two live ghost fleets on the same mesh is a **behavioural** change, not just a capacity one
— both regions would connect to MQTT and answer the same DMs. Region mirroring is designed
but unbuilt (see [[project_mqtt_region_mirror]]), and the topic/region distinction has bitten
before ([[reference_mesh_mqtt_region_topic_gotcha]]). Decide the fleet-identity story first;
a second region is not a drop-in replica here.

Deploys go through GitHub Actions only (AGENTS.md Essential Rule 4) — never a local
`terragrunt apply`.
