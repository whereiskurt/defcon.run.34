# AGENTS.md — run.status (status.defcon.run)

Instructions for AI agents updating the public status page.

## What this is

`status.defcon.run` is a **static** page — S3 origin + CloudFront, no ECS/Node/backend. It has its own Terragrunt state and does not touch the shared CloudFront/global infra. All content lives under `apps/run.status/site/`:

- `status.json` — the service list + per-service `state` (the thing you usually change).
- `index.html` — the self-contained page (inline CSS/JS; polls `status.json`). Also holds the **MATRIX RUN** mini-game (canvas, no data file) that sits below the title.

It is **global / single source** — one S3 origin, one CloudFront, one `status.json`. The `regions` array in the JSON is display-only chips; a status change is global.

## Preferred path: the skill

To flip service statuses, use the **`/dc34-statuspage`** skill — it shows the services, lets the user check-box which to change, pick one state, previews the diff, and publishes. It wraps the mechanics below safely.

## Status vocabulary (EXACTLY three)

`index.html` renders only these `state` values; anything else shows with no dot/color:

| Meaning | `state` | Render |
|---|---|---|
| Online / stable | `live` | ● stable (green) |
| Active dev | `dev` | ◐ active dev (amber) |
| Offline | `down` | ○ offline (red) |

The banner shows "degraded" if any service is `dev` or `down`.

## Manual update mechanism

```bash
cd apps/run.status
# 1. edit site/status.json — change a service's `state` (live|dev|down), and/or version/note.
#    Or use the setter (validates ids + states, leaves `updated` alone):
#      .claude/skills/dc34-statuspage/scripts/set-status.sh human=down gpx=live
# 2. publish:
./release.sh --status-only   # fast: status.json only
./release.sh                 # full sync of site/ + invalidate (use when index.html changed)
```

`release.sh` uses AWS profile `dc34-application` (region `us-east-1`), discovers bucket/distribution/prefix from SSM (`/dc34/status-site/*`), stamps `status.json.updated` via `jq`, `aws s3 sync`s to the origin, and invalidates CloudFront. Live within ~30s.

## Rules

- **`state` must be `live` | `dev` | `down`** — no other values.
- **Never hand-edit `updated`** — `release.sh` stamps it (`--no-stamp` to skip).
- **`cms` intentionally has no `link` field** — don't add one.
- **AWS**: needs the `dc34-application` profile. If `aws sts get-caller-identity --profile dc34-application` fails, authenticate before publishing.
- **First-time infra provisioning only** (not content updates): `cd infra/terraform/live/site/region/us-east-1/status-site && terragrunt apply`.

## Canonical reference

`apps/run.status/README.md` — full guide (infra, release mechanics, easter eggs). Read it for anything beyond a routine content/state update.
