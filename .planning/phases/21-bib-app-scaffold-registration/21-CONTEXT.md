# Phase 21: Bib App Scaffold + Registration - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning (plan in detail when Phase 20 completes)

<domain>
## Phase Boundary

Stand up the bib.defcon.run Next.js webapp (mirroring `apps/run.flash/webapp/`) and the registration data path: a `Bib` ElectroDB entity on the shared electro table, a registration form (name on bib), create/fetch API routes, and the OIDC `bib`-claim auth gate. Plus the nginx reverse-proxy container. No payment logic (Phase 22), no release pipeline wiring (Phase 23).

</domain>

<decisions>
## Implementation Decisions

### Scaffold (app shell from run.flash, AUTH from run.gpx)
- **Container/app shell + nginx** from run.flash (two-container layout): region basePath, `providers.tsx`, `layout.tsx`, theme switch, fonts, `config/site.ts`
- nginx container: copy `apps/run.flash/nginx/` (Dockerfile.nginx, nginx.conf, /hello health endpoint), swap APP_URL to bib
- Strip flash-only surface: Web Serial, device-picker, esptool, meshtastic libs, firmware config — none apply to bib

### Auth = copy run.gpx (login required to get a bib)
- Copy `apps/run.gpx/webapp/src/config/auth.ts`, `middleware.ts`, `app/signin/`, and `app/access-denied/` — these are the authoritative auth pattern for bib (NOT flash)
- `middleware.ts`: edge-protect the bib registration routes via the Auth.js `auth()` wrapper → redirect unauthenticated users to `/signin`, then require `services.includes("bib")` → else `/access-denied`. Set the `matcher` to bib's protected routes (registration/confirmation), excluding `/signin`, `/access-denied`, static assets, and the Stripe webhook route
- `config/auth.ts`: full-path `AUTH_URL` (`/{region}/api/auth`, `basePath: "/api/auth"`), OIDC provider to auth.defcon.run, `fetchFreshClaims` live re-validation (lockout + sessionVersion), and **rename the service-scoped cookies** `sess_gpx`→`sess_bib`, `csrf_gpx`→`csrf_bib`, `callback_gpx`→`callback_bib`, `state_gpx`→`state_bib`; `redirectProxyUrl` from `BIB_PUBLIC_URL`
- Service claim string is `bib`; OIDC secrets resolve from `/{site}/secrets/{region}/bib/client_id|client_secret` (created Phase 20)

### Auth-server dependency (in-repo, autonomous)
- OIDC clients are registered **in the run.auth repo**, not an external console: `apps/run.auth/webapp/src/config/oidc.ts` (client entry: client_id/secret + redirect_uris + post_logout_redirect_uris) and `apps/run.auth/webapp/src/config/index.ts` (`oidc.clients.*` with env-sourced id/secret). Registering the `bib` client is a code change an autonomous agent CAN make.
- Required run.auth changes for bib: add a `bib` client to `oidc.ts`/`index.ts` (redirect_uris = `https://bib.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/auth/callback/...` mirroring gpxStudio), add `OIDC_BIB_CLIENT_ID`/`OIDC_BIB_SECRET` env + matching SSM, and ensure the `bib` string is grantable as a service claim. run.auth must be redeployed for the client to take effect (fold into the Phase 23 release, or an interim run.auth deploy).
- Runtime/admin (not code): a user must be **granted the `bib` service claim** to pass the gate — note this is an admin/runtime action for real accounts (or seed a test user).

### Bib entity (account-linked, shared electro table)
- **The bib is written to the authenticated user's account** — you must log in, then the bib you choose is persisted against your identity and shown to you on every subsequent login. It is never anonymous/ephemeral.
- New `Bib` ElectroDB entity in `apps/run.bib/webapp/src/entities/` reusing the `electroClient` + `ELECTRO_TABLE` pattern from run.human (`entities/client.ts`)
- **Owner key = the session's OIDC `sub`** (from the run.gpx-style auth session). Keying by `sub` keeps the bib service self-contained (no cross-service lookup needed to save/read the user's own bib).
- Attributes: `bibId`, `ownerSub` (OIDC sub — required), `nameOnBib`, `bibNumber` (assigned display number, see visual below), `size` (optional), `paymentStatus` (`unpaid` | `pending_payment` | `pay_on_site` | `paid`), `amount`, `currency`, `paymentProvider` (`none` | `cash` | `stripe` | `paypal` | `coinbase` | …; provider-agnostic per Phase 22), `createdAt`, `updatedAt`
- Index to fetch a user's registration by `ownerSub` (avoid colliding with existing run-user/checkin GSIs — follow the CheckIn gsi2/gsi3 precedent)
- **One active bib per account** (idempotent create keyed by `ownerSub`); re-visiting shows/edits the existing bib rather than creating a duplicate

### Identity nuance (sub vs Auth.js userId) — important
- Per the project's known architecture, the **OIDC `sub` ≠ the Auth.js/DynamoDB adapter `userId`** used by `RunUser` (run.human) and `auth-profile` (run.auth). Both those entities are keyed by the adapter `userId`, not the `sub`.
- **Primary storage keys by `sub`** — correct and sufficient for "the bib is saved to your login" within the bib service. Do NOT assume `sub == RunUser.userId`.
- **Optional cross-service surfacing (deferred / product call):** to show the bib on the run.human profile (run.defcon.run) or as an auth-profile attribute, resolve `sub → userId` via the existing run.human internal API (the same resolution flash/mqtt use for credentials), then write a small denormalized summary (`bibNumber`, `nameOnBib`, `paymentStatus`) onto `RunUser`. Treat as an enhancement, not core to v1.5 — the bib is already account-linked via `ownerSub`.

### Registration UX
- Single form: name-on-bib input with validation (**~32 character hard cap** via `maxLength`, allowed character set), live bib preview component, optional size select
- Enforce the 32-char cap both client-side (input `maxLength={32}`) and server-side (reject longer in the create API)
- Submit persists an `unpaid` registration, then routes to the confirmation/payment step (payment is Phase 22)

### Bib visual design (the hero of the page)
- The registration UI should **look like a physical running race bib**: a standard bib card — large centered **bib number**, the **name-on-bib** prominently below/within it, DEF CON Run 34 event branding (DC34 logo `apps/run.mqtt/nginx/dc34-logo*.webp`, event name + 2026), and the classic bib look (bold border, perforation/corner registration-mark accents, optional faux safety-pin holes in the corners).
- The **live preview updates as the user types** the name — what they see is what prints. This preview IS the bib card component reused on the confirmation page.
- **Auto-shrink name text:** the name always fits on one line within the bib width — short names render large and bold; as the name grows the font size **scales down** to keep it inside the bib. Approach: a fit-to-width component (measure text vs. container and reduce font-size, or an SVG `<text>` with a fixed `viewBox` / `textLength` so it scales intrinsically — SVG is the simplest robust option and prints cleanly). Clamp between a max (short names) and a sensible min font-size; combined with the ~32-char cap the min size stays legible. No wrapping, no truncation/ellipsis — the whole name shows, just smaller.
- It is a **standard bib** (one design for everyone), but build it as a single styled component so prior-year / themed layouts can be swapped via a variant prop later. **Past-year bib layouts are an external reference the user will provide** — treat them as visual inspiration for the standard DC34 bib; do not block on them.
- Self-contained CSS/Tailwind (no external bib library); print-friendly so a participant could screenshot/print their bib.

### API auth
- API routes read the session server-side via the gpx `auth` export; reject unauthenticated; derive owner from session `sub` (never trust client-supplied owner)
- Re-check the `bib` service claim server-side on mutating routes (defense in depth beyond middleware)

</decisions>

<specifics>
## Specific Ideas
- Keep it well under the project's simplicity bar — registration is a single entity + two routes + one form
- Reuse HeroUI + Tailwind 4 components already used across the monorepo
- `bib` auth client must be registered on the auth server (dependency surfaced to operator); SSM client_id/secret slots already exist from Phase 20

</specifics>

<code_context>
## Existing Code Insights
- App shell template: `apps/run.flash/webapp/src/` (app/, components/, config/site.ts, providers, layout)
- **Auth template (authoritative): `apps/run.gpx/webapp/src/config/auth.ts`, `middleware.ts`, `app/signin/`, `app/access-denied/`** — copy these, rename cookies + claim to bib
- Entity pattern: `apps/run.human/webapp/src/entities/{client.ts,checkin.ts}` (ElectroDB on shared electro table, gsi2/gsi3 to avoid collisions)
- nginx: `apps/run.flash/nginx/`

</code_context>

<deferred>
## Deferred Ideas
- Stripe / payment → Phase 22
- build/deploy/CI wiring → Phase 23

</deferred>

---
*Phase: 21-bib-app-scaffold-registration*
*Context gathered: 2026-06-30*
