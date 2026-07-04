# status.defcon.run — Design Spec

**Date:** 2026-07-03
**Branch/worktree:** `feat/status-page` (isolated git worktree)
**Status:** approved, building

## Goal

A **fully static** status page at `status.defcon.run` — no ECS, no Node runtime — so
people can quickly tell whether a service is intentionally down/in-dev ("it's us, not
you") vs. actually broken. Updated by hand: change a JSON file, run a release script.

## Architecture

```
status.defcon.run  ──(A/AAAA alias, apex zone in mgmt acct)──▶  CloudFront
                                                                   │  viewer-request fn:
                                                                   │   /  → 302 /use1/
                                                                   │   dir → +index.html
                                                                   ▼
                                                        S3 bucket (private, OAC-only)
                                                            s3://<bucket>/use1/…
```

- **S3** private bucket, OAC-only origin. Content lives under a `use1/` prefix (region
  label, matching the platform's `use1/cac1/apse1` convention).
- **CloudFront** distribution, alias `status.defcon.run`, ACM cert (us-east-1). A
  CloudFront Function forwards `/` → `/use1/` and resolves directory index.
- **ACM** cert in the application account; **DNS validation + alias records** written to
  the apex `defcon.run` zone in the **management** account (via the `management`
  provider). Standard cross-account validation.
- **Caching:** HTML/asset shell via `Managed-CachingOptimized` (hard cached). `*.json`
  via a custom short-lived policy (default 30s, max 60s) so status changes appear fast.

## Isolation (another agent is deploying concurrently)

- Separate git worktree + branch — no file collisions.
- A brand-new Terragrunt unit (`region/us-east-1/status-site`) → **its own state key**
  (`use1/region/us-east-1/status-site/terraform.tfstate`) → no lock contention.
- A self-contained module that owns all its resources. It **does not** modify
  `site.hcl`, the shared `global/cloudfront` module, or any existing service — only
  read-only `dependency` on the `site` module's `zone_map` output for the apex zone id.
- Apply is scoped to this single unit (never `run-all`); plan is inspected to confirm it
  is purely additive before apply.

## Content model

`site/status.json` (data) drives the page:

- `regions[]` — `{id, deployed}`; renders region chips (`use1` on, others dimmed).
- `services[]` — `{id, name, host, version, state, note}`.
- `state ∈ {live, dev, down}` → renders as **stable / active dev / offline**
  (🟢 `#22c55e` / 🟡 `#f59e0b` / 🔴 `#ef4444`).
- `poll_seconds` — page re-fetches `status.json` on this countdown (default 300 = 5 min).

`site/marquee.json` (`{items:[...]}`) drives the scrolling ticker (content owned by the
site owner).

## Design system

Matches `run.human` exactly: dark `#0a0a0f` bg + noise overlay + glass cards, brand teal
`#00d4aa`; fonts MuseoModerno / Inter / Fira Code / Atkinson Hyperlegible. Dark/light
toggle uses the DC34 light tokens (`#fafafa` / `#00a888`), persisted in `localStorage`.

## Easter eggs

- Konami (↑↑↓↓←→←→BA) **or** 5 rapid taps → Matrix rain; auto-exits after 10s.
- Exiting Matrix / typing `elkentaro` → 🎂 `run.elkentaro` birthday card pinned to top,
  with a link (`ELKENTARO_URL`, currently a rickroll → later a Google Form) and a
  birthday photo to be sourced from last year's CMS upload backup.
- Source-crawler clues: HTML comment banner, hidden `#ghost` block with `data-*`
  breadcrumbs, and a styled devtools console banner. (base64 / rot13 hints.)

## Release

`apps/run.status/release.sh` (profile `dc34-application`): reads bucket/dist/prefix from
SSM, stamps `status.json.updated`, syncs `site/` → `s3://<bucket>/use1/`, invalidates
CloudFront. `--status-only` for fast content-only pushes.

## Out of scope (YAGNI)

- No real health-checking / uptime probing — status is manual by design.
- No multi-region deploy yet (`cac1`/`apse1` shown as not-deployed).
- Auto-reading service `VERSION` files into `status.json` — possible later.
