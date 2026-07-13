# Admin: add/remove identity services — Design

**Date:** 2026-07-12
**Service:** run.auth (`auth.defcon.run/use1/admin`)
**Status:** Approved (design shape + decisions locked by Kurt) — ready for implementation plan

## Problem

In the identity admin console, an AuthProfile's `services` list is shown as read-only
color chips. Services gate access: `admin`/`runadmin` drive the run.auth admin check,
and others gate run/gpx/flash/etc. Today there's no way to grant or revoke a service
from the console — you'd have to edit DynamoDB by hand. We want an admin to **add** a
user to an arbitrary service (picking a known one from a dropdown, or typing a new one)
and **remove** one, right from the drawer.

## Decisions (locked)

1. **Add + remove** (not add-only). Each existing service chip gets a small `×` to remove it.
2. **Dropdown source = canonical ∪ observed + free-text.** The add control offers the
   canonical set UNION every distinct service seen across the loaded identities, plus a
   free-text field to type a brand-new one.
3. **NO `sessionVersion` bump on a services change (KURT'S EXPLICIT CALL).** Adding or
   removing a service must **not** log the target user out. The change settles over time
   via natural token refresh; do not force a re-login.

## Architecture

### Data
`AuthProfile.services` (ElectroDB `list` of `string`, `src/entities/auth-profile.ts`).
Default seed `DEFAULT_SERVICES = ["auth","run","strava","gpxstudio","flash"]`. No schema
change needed.

### Canonical service set (constant, tunable in one place)
```
CANONICAL_SERVICES = ["auth","run","runadmin","admin","strava","gpxstudio","gpx","flash","cms"]
```
The console's dropdown = `CANONICAL_SERVICES` ∪ (distinct services across all loaded rows),
sorted, minus the ones the current identity already has. Free-text input adds a new one.

### Service-name validation (shared, testable)
A service name is valid iff (after `.trim().toLowerCase()`): `^[a-z][a-z0-9-]{0,31}$`.
Rejects spaces, quotes, injection, empties, over-long. Put this in a tiny pure helper
(e.g. `src/lib/services.ts` `isValidServiceName(s): boolean` + `CANONICAL_SERVICES`) with
unit tests — this is the one piece worth TDD.

### API route (session-gated, mirrors jail/lock)
`POST /api/admin/identities/[userId]/services` — body `{ action: "add" | "remove", service: string }`.
- Gate: `await auth()` + `requireAdmin` + `revalidateAdmin`; deny → **404** (non-disclosure).
  `runtime="nodejs"`, `dynamic="force-dynamic"`, response `Cache-Control: no-store`.
- Validate `action` ∈ {add,remove} (400 otherwise) and `isValidServiceName(service)` (400 otherwise).
  Manual validation, no zod.
- Load profile (404 if absent). Compute the next `services`:
  - **add:** if already present → no-op success (idempotent); else append.
  - **remove:** if absent → no-op success; else filter out. **Never let the list become empty**
    — if a remove would empty it, reject with 400 (`{error:"cannot remove last service"}`).
- Persist with `AuthProfile.update({userId}).set({ services: next }).go()`.
  **DO NOT bump `sessionVersion`** (decision 3). Return `{ ok: true, services: next }`.
- Note (documented, accepted): a **revoke** won't cut off a consuming service until the
  target's token naturally refreshes (`updateAge` 24h) — the run.auth admin check itself is a
  live `getAuthProfile` read so admin grants/revokes bite immediately *there*. If an immediate
  cutoff is ever needed, use the existing `invalidate-sessions` action separately.

### UI (`src/app/admin/AdminConsole.tsx`)
In the drawer's services area (and reuse the existing `Tag` chip styling / `GROUP_COLOR`):
- **Removable chips:** render each service as its `Tag` plus a small `×` button. Clicking `×`
  removes it via the route, then updates the drawer. **Confirm dialog for risky removes:**
  core `auth`/`run`, privilege `admin`/`runadmin`, OR removing a service from the admin's
  **own** identity (`drawer.identity.userId === session.user.id` — the console already knows
  the admin's own id / `adminEmail`; compare by userId). Non-risky removes can be immediate or
  lightly confirmed — keep it consistent with the existing `LockAction`/`JailAction` confirm style.
- **`+ add` control:** a small button that reveals an inline combobox — an `<input>` wired to a
  `<datalist>` of the computed known-services list (canonical ∪ observed minus already-present),
  so the admin can pick a known one OR type a new one. Enter / a small "Add" button submits.
  Client-side pre-validate with the same regex for instant feedback; the route re-validates.
- All fetches use the `BASE` region prefix (`/use1` in prod) or they 404. On success, refresh
  the drawer (re-`openDrawer(userId)`) and `router.refresh()` so the table chips update too.
- Put the add/remove action component in `src/app/admin/AdminActions.tsx` next to
  `LockAction`/`JailAction` (mirror their `useRouter`/`useState`/bare-`/api/...`-path style, and
  reuse the `dangerBtn` token for the remove `×`).

### Report/list plumbing
`IdentityRow.services` already exists and flows through `identity-report.ts` +
`scanAuthProfiles()` (`src/entities/admin-identity.ts`) and the drawer GET route
(`identities/[userId]/route.ts` → `Detail.identity.services`). No projection change needed
(services is already copied in both hand-rolled projections — verify, but it's already displayed).

## Scope

**In (v1):** `isValidServiceName` + `CANONICAL_SERVICES` helper (+ tests); `POST .../[userId]/services`
add/remove route; drawer removable chips (risky-remove confirm) + `+ add` combobox
(datalist known ∪ free-text); dropdown known-list = canonical ∪ observed.

**Out (follow-ups):** bulk add across multiple identities; a services filter pill; an
immediate-revoke variant (bump sessionVersion) — deliberately excluded per decision 3; audit
logging of grants/revokes (could reuse `logEvent`, e.g. `admin.service.add` — nice-to-have).

## Tradeoffs / Risks

- **No forced logout (decision 3):** a revoke is not immediate for consuming services (up to
  `updateAge` 24h). Accepted — Kurt prefers not to log people out on a grant. Documented above.
- **Free-text services** could create typos ("gpxstduio"). Mitigated by the canonical dropdown
  being the easy path + the validation regex; typos are removable.
- **Never-empty guard** prevents accidentally orphaning an identity with zero services.
- **Injection:** the service string is validated to `^[a-z][a-z0-9-]{0,31}$` before any use; it's
  stored in a DynamoDB list (not interpolated into a query), so risk is low regardless.

## Key files

- `src/lib/services.ts` — NEW `CANONICAL_SERVICES` + `isValidServiceName` (+ `services.test.ts`)
- `src/app/api/admin/identities/[userId]/services/route.ts` — NEW add/remove route
- `src/app/admin/AdminActions.tsx` — NEW `ServiceEditor`/`AddServiceAction` + removable-chip handler
- `src/app/admin/AdminConsole.tsx` — drawer services area: removable chips + `+ add` combobox; compute known-list
- `src/entities/auth-profile.ts` — `services` attribute (reference; no change) + `DEFAULT_SERVICES`

## Implementation notes for the builder

- Mirror the **jail route** (`src/app/api/admin/identities/[userId]/jail/route.ts`, shipped in
  PR #565) for the gate boilerplate — but **do not** copy its `sessionVersion` bump.
- Lands on branch `gsd/admin-services` (off main-with-Altcha). It touches `AdminConsole.tsx`,
  which PR #573 (IP visibility) also touches — rebase whichever merges second (same as
  IP-on-Altcha was handled). Build via subagent-driven-development, own PR, `--admin` squash-merge
  is the repo pattern. No infra/IAM change. Versioning is owned by buildpub (VERSION/VERSION.app);
  do NOT bump package.json. Node ≥22.12 for vitest (`nvm use 23.6.0`).
