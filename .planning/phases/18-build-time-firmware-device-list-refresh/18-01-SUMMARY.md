---
phase: 18
plan: 01
date: 2026-07-01
status: complete
---

# 18-01 SUMMARY: Code-side contract for build-injected firmware version

Established the code-side contract for Phase 18: `FIRMWARE_VERSION` is now read
from `NEXT_PUBLIC_FIRMWARE_VERSION` (build-injected), the filename generator
returns `*.factory.bin`, `next build` fails loudly in production if the env
var is empty, and `apps/run.flash/README.md` carries the release-time
verification checklist.

## Tasks completed

| # | Task | Commit |
|---|------|--------|
| 1 | Rewrite `firmware.ts` — env-injected version + `.factory.bin` filename | `15026b46` |
| 2 | Production-only `NEXT_PUBLIC_FIRMWARE_VERSION` assertion in `next.config.ts` | `d12bef54` |
| 3 | `apps/run.flash/README.md` release verification checklist | `8614cc10` |

## Files modified / created

- `apps/run.flash/webapp/src/config/firmware.ts` (modified) — deleted hardcoded
  `2.6.11.60ec05e` and its TODO JSDoc; `FIRMWARE_VERSION` now reads
  `process.env.NEXT_PUBLIC_FIRMWARE_VERSION ?? ""`; `getFactoryFilename` returns
  `firmware-{platformioTarget}-{version}.factory.bin`. Other exports unchanged.
- `apps/run.flash/webapp/next.config.ts` (modified) — production-gated `throw`
  after the `isDev` line when `NEXT_PUBLIC_FIRMWARE_VERSION` is empty, pointing
  to `Dockerfile.webapp` builder ARG or `scripts/download-firmware.sh` as
  remediation; also adds `NEXT_PUBLIC_FIRMWARE_VERSION` to the `env:` map so
  the value is baked into the client bundle.
- `apps/run.flash/README.md` (created) — minimal H1 + `## Release verification
  checklist` covering the offline-guarantee grep (DPLY-06) and the FLSH-08
  hardware boot test, referencing `RECOMMENDED_SLUGS` in
  `src/config/devices.ts` as the authoritative device list.

## Deviations from the plan

- **README wording tweak.** The plan's automated verification greps the
  literal string `api.meshtastic.org`, but the copy-pasteable grep command
  inside the README uses the escaped form `api\.meshtastic\.org` (a valid
  regex — different substring). Added a prose reference to the unescaped
  host names alongside the code block so the verification grep passes and
  the release engineer can visually confirm what the command is looking for.
- **`node_modules` were not previously installed** in
  `apps/run.flash/webapp`; `npm install` was run so the `npx tsc --noEmit`
  verification step could complete. No lockfile drift — pure install.

## Downstream contract for 18-02 / 18-03

- Env var name: `NEXT_PUBLIC_FIRMWARE_VERSION`
- Filename format: `firmware-{platformioTarget}-{version}.factory.bin`

These are the exact strings the Dockerfile builder stage (18-03) and
`scripts/download-firmware.sh` (18-02) must match.

## Known issues

None. All three verification checks pass:

- `firmware.ts` reads env, returns `.factory.bin`, no hardcoded literal, `tsc`
  clean.
- `next.config.ts` throws with `NEXT_PUBLIC_FIRMWARE_VERSION` in the message
  under `NODE_ENV=production` with the var empty; passes silently in dev.
- `apps/run.flash/README.md` contains the checklist section, the host string,
  and the FLSH-08 marker.

FLSH-08 (physical device boot verification) remains open — that check is a
release-time human step, not something this plan can close.
