---
name: dc34-statuspage
description: Update the live status.defcon.run service statuses interactively. Use when the user wants to change a DEF CON run service's status on the status page, set services online/active-dev/offline, or types /dc34:statuspage or /dc34-statuspage. Shows the services, lets the user check-box which to change, pick one state for the batch, preview the diff, and publish live via release.sh.
---

# DC34 Status Page

Interactively update `status.defcon.run` — a static S3+CloudFront page whose data lives in `apps/run.status/site/status.json`. This skill flips service **state**, previews the change, and publishes it live.

## Status vocabulary (EXACTLY three)

The page renders only these `state` values — anything else shows with no color/dot:

| User-facing | JSON `state` | Renders as |
|---|---|---|
| Online / stable | `live` | ● stable (green) |
| Active dev | `dev` | ◐ active dev (amber) |
| Offline | `down` | ○ offline (red) |

## Workflow

1. **Show current status.** Read `apps/run.status/site/status.json` and present the services as a table: `id`, `name`, `host`, `version`, current `state`. (Today's services: `auth`, `human`, `gpx`, `flash`, `bib`, `cms`.)

2. **Pick services** — use `AskUserQuestion` with `multiSelect: true`, one option per service (label = `id (current-state)`, description = host). This is the check-box step. **`AskUserQuestion` allows at most 4 options per question and up to 4 questions per call**, so when there are more than 4 services, split them into groups of ≤4 across multiple `multiSelect` questions **in a single call** (supports up to 16 services) and union the selections. You may include the state question (step 3) as an additional question in that same call to gather everything in one prompt.

3. **Pick the new state** — one of three options: **Online (`live`)**, **Active dev (`dev`)**, **Offline (`down`)**. One state applies to all checked services (batch). (Can be asked in the same `AskUserQuestion` call as step 2.)

4. **Apply** — run the bundled setter (validates state + service ids, edits only the `state` fields, never touches `updated`):
   ```bash
   .claude/skills/dc34-statuspage/scripts/set-status.sh <id>=<state> [<id>=<state> ...]
   # e.g. set two services offline:
   .claude/skills/dc34-statuspage/scripts/set-status.sh human=down gpx=down
   ```

5. **Preview & no-op guard** — show `git diff apps/run.status/site/status.json` so the user sees exactly what changed. **If there is no diff** (every chosen state already matched the current state), report "no changes — nothing to publish" and STOP. Do not publish a no-op.

6. **Confirm, then publish live:**
   ```bash
   cd apps/run.status && ./release.sh --status-only
   ```
   Report that it's live at https://status.defcon.run within ~30s (CloudFront invalidation). `release.sh` uses AWS profile `dc34-application` and auto-stamps the `updated` timestamp.

## Constraints

- **State must be `live` | `dev` | `down`.** The setter rejects anything else.
- **Never hand-edit `updated`** — `release.sh` stamps it. Never hand-edit `state` in the JSON directly; use the setter so ids/states are validated.
- **`cms` intentionally has no `link` field** — don't add one.
- **AWS**: publishing needs the `dc34-application` profile (SSM read + S3 write + CloudFront invalidate). If `aws sts get-caller-identity --profile dc34-application` fails, stop before step 6 and tell the user to authenticate.
- This skill only changes **state**. To edit a service's `version`, `note`, or the `marquee.json` ticker, do it directly in the JSON, then run `./release.sh` (full) — that's out of this skill's batch flow.

## Reference

`apps/run.status/README.md` is the canonical guide to the status site (infra, release mechanics, easter eggs). Read it for anything beyond a state flip.
