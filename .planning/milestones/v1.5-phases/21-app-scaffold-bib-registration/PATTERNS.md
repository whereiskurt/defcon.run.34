# PATTERNS.md — v1.5 Phase 21

Maps each Phase 21 file to its closest existing analog with rationale for the mapping.

## Auth mirror (SC #3, #8)

| Phase 21 target file | Source pattern | Rationale |
|---|---|---|
| `apps/run.bib/webapp/src/config/auth.ts` | `apps/run.gpx/webapp/src/config/auth.ts` | Kurt-locked mirror source. Verbatim copy + string swap `gpx` → `bib`. Note: preserve the fetchFreshClaims + validateAndUpdateClaims logic — that's the shared session-invalidation contract with run.auth. |
| `apps/run.bib/webapp/src/middleware.ts` | `apps/run.gpx/webapp/src/middleware.ts` | Same auth-guard pattern. Whitelist same paths (`/signin`, `/access-denied`, `/api/auth/*`, `/api/health`). |
| `apps/run.bib/webapp/src/app/signin/page.tsx` | `apps/run.gpx/webapp/src/app/signin/page.tsx` | Auto-redirect signin page that jumps straight to OIDC provider. |
| `apps/run.bib/webapp/src/app/access-denied/page.tsx` | `apps/run.gpx/webapp/src/app/access-denied/page.tsx` | Standard access-denied UI. String-swap only. |
| `apps/run.bib/webapp/src/app/api/auth/[...nextauth]/route.ts` | `apps/run.gpx/webapp/src/app/api/auth/[...nextauth]/route.ts` | NextAuth handlers re-export from `config/auth.ts`. |

## Entities (SC #2)

| Phase 21 target file | Source pattern | Rationale |
|---|---|---|
| `apps/run.bib/webapp/src/entities/client.ts` | `apps/run.human/webapp/src/entities/client.ts` | Same ElectroDB client on same shared `run-human-electro` table. Verbatim copy — no swaps needed. Uses `RUN_ELECTRO_ID/SECRET/REGION/DBNAME` env vars from Phase 20 SSM. |
| `apps/run.bib/webapp/src/entities/bib.ts` | `apps/run.human/webapp/src/entities/checkin.ts` (structure) + `run-user.ts` (single-record-per-user shape) | Bib is one-per-user like RunUser. Use `service: "run"` (shared table service), `entity: "Bib"`. PK `ownerSub`; SK a fixed literal `"BIB"` to allow single-record semantics. Reserve a secondary index `byRunnerCode` on the pre-existing `runnerCode-index` GSI (hash_key `runnerCode`). |
| `apps/run.bib/webapp/src/entities/bib-reconcile.ts` | `apps/run.human/webapp/src/entities/checkin.ts` (indexes) | Different key shape but same entity/index/GSI wiring. PK `receiptId`; secondary index by `matchedOwnerSub` (a `gsi2pk-gsi2sk-index` — verify GSI is available on the shared table before wiring; if not, wire to the existing free GSI). |

## API routes (SC #7)

| Phase 21 target file | Source pattern | Rationale |
|---|---|---|
| `apps/run.bib/webapp/src/app/api/bib/route.ts` | `apps/run.gpx/webapp/src/app/api/**/route.ts` (any read-your-own resource route) | Single-file with GET/POST/PATCH exports. All three enforce `auth()` session + return 401 on no session. |
| `apps/run.bib/webapp/src/lib/runner-code.ts` | `apps/run.human/webapp/src/entities/run-user.ts` (crypto.randomBytes usage) | 4-char BIB-XXXX generator. Use crypto.randomBytes(3) → base32 alphabet minus ambiguous chars (no `0OIL1`). Collision-safe: query `byRunnerCode` on the `runnerCode-index` GSI in a retry loop (max 3 attempts). |

## UI (SC #4, #5)

| Phase 21 target file | Source pattern | Rationale |
|---|---|---|
| `apps/run.bib/webapp/src/app/layout.tsx` | `apps/run.flash/webapp/src/app/layout.tsx` | Two-container ECS app shell + HeroUI/Tailwind 4 base. |
| `apps/run.bib/webapp/src/app/providers.tsx` | `apps/run.flash/webapp/src/app/providers.tsx` | HeroUI + Theme providers pattern. |
| `apps/run.bib/webapp/src/app/page.tsx` | `apps/run.flash/webapp/src/app/page.tsx` | Landing page shell — replace with bib registration UI hosting `BibForm` + `BibPreview`. |
| `apps/run.bib/webapp/src/components/BibPreview.tsx` | new (SVG-only) | DC34 bib SVG template. Take design cue from any existing SVG in `apps/run.flash/webapp/public/` — bib visual asset is a Kurt-provided SVG asset (may need Kurt to hand off; if absent, ship a minimal placeholder rectangle). Live prop: `{name: string, code: string}`. Renders `1337` if `name` empty, else `name` auto-shrunk to fit. |
| `apps/run.bib/webapp/src/components/BibForm.tsx` | `apps/run.flash/webapp/src/components/*` (form patterns; HeroUI Input controlled component) | Controlled input driving `BibPreview` prop. Submit calls POST/PATCH `/api/bib`. |

## Docker + version files (SC #1)

| Phase 21 target file | Source pattern | Rationale |
|---|---|---|
| `apps/run.bib/webapp/Dockerfile.webapp` | `apps/run.flash/webapp/Dockerfile.webapp` OR `apps/run.gpx/webapp/Dockerfile.webapp` | Choose gpx (Next.js only, no firmware stage). Standalone runtime + tini + non-root user. |
| `apps/run.bib/webapp/VERSION` | `apps/run.gpx/webapp/VERSION` | Seed with `0.1.0`. |
| `apps/run.bib/nginx/*` | `apps/run.flash/nginx/*` | Only if run.bib needs the nginx reverse-proxy sidecar; check service.hcl — Phase 20 wired a two-container (nginx + app) task, so YES. Copy `nginx.conf` + `Dockerfile.nginx` + `VERSION` from run.flash, string-swap `flash` → `bib`, port 443 → per-app if different (verify against service.hcl port_mappings). |
