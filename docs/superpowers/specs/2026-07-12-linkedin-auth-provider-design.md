# LinkedIn as a login provider on `run.auth` — design

- **Date:** 2026-07-12
- **Status:** Approved (design) — ready for implementation plan
- **Branch:** `worktree-linkedin`
- **Scope:** Add "Sign In with LinkedIn using OpenID Connect" as a first-class login provider on the `run.auth` broker, mirroring the existing Discord/GitHub pattern.

## Context / architecture

`run.auth` (`apps/run.auth/webapp`) is a two-layer identity broker:

1. **Upstream federation (Auth.js / NextAuth v5):** federates out to GitHub, Discord, Strava, and email magic-links. Provider array lives in `src/config/auth.ts`.
2. **Downstream OIDC provider (panva `oidc-provider`):** issues tokens to first-party relying parties (run.human, cms, gpx, flash, bib). Config in `src/config/oidc.ts`.

**LinkedIn slots into layer 1 only.** Downstream relying parties need zero changes — they keep consuming the same `run.auth` OIDC tokens. The only downstream-visible effect is `"linkedin"` optionally appearing in the `linked_providers` claim.

LinkedIn's current product is **"Sign In with LinkedIn using OpenID Connect"** (scopes `openid profile email`). It is self-serve; no company/business verification is required — only a LinkedIn Page association (a throwaway Page the app owner creates and self-verifies as admin).

## Goal & non-goals

**Goal:** A user can click "LinkedIn" on the login page (and header dropdown), authenticate with LinkedIn, and get an account created/logged-in on `run.auth` — gated by the existing email allowlist, with `allowDangerousEmailAccountLinking` so a LinkedIn login lands on the same account as a matching email/GitHub/Discord signup. LinkedIn profile data is cached in `AuthProfile` and surfaced in `linked_providers` / the profile API, exactly like Discord/GitHub ("mirror the pattern").

**Non-goals:**
- No changes to downstream relying parties.
- **No profile-page linked-accounts card** for LinkedIn this pass (the `profile/page.tsx` UI card is deferred; the profile *API* still surfaces it).
- No LinkedIn vanity/public-profile URL — it is **not** available via the `openid profile email` scopes (would require an extra API + product), so it is intentionally dropped.
- Strava-style dedicated "link" page is out of scope (LinkedIn is a login, not a link-only provider).

## Prerequisites (completed by the operator)

- LinkedIn Developer app created, associated with a self-owned LinkedIn Page, "Sign In with LinkedIn using OpenID Connect" product granted.
- **Authorized redirect URLs** registered on the LinkedIn app (exact match, no trailing slash):
  - `https://auth.defcon.run/use1/api/auth/callback/linkedin`
  - `https://auth.defcon.run/cac1/api/auth/callback/linkedin`
  - `http://localhost:3002/api/auth/callback/linkedin` (dev; optional if LinkedIn rejects plain http)
- **SSM parameters applied** (all four, `SecureString`):
  - `us-east-1` → `/dc34/secrets/use1/linkedin/client_id`, `/dc34/secrets/use1/linkedin/client_secret`
  - `ca-central-1` → `/dc34/secrets/cac1/linkedin/client_id`, `/dc34/secrets/cac1/linkedin/client_secret`
  - (Optional local dev, us-east-1) `/defcon.run/auth/linkedin/id`, `/defcon.run/auth/linkedin/secret`

## Detailed changes

### 1. Provider registration — `src/config/auth.ts`

Import and register the provider (after the Discord block in the `providers` array):

```ts
import LinkedIn from "next-auth/providers/linkedin";

LinkedIn({
  clientId: config.providers.linkedin.clientId,
  clientSecret: config.providers.linkedin.clientSecret,
  allowDangerousEmailAccountLinking: true,
  authorization: {
    params: {
      scope: "openid profile email",
      redirect_uri: `${config.urls.baseUrl}/api/auth/callback/linkedin`,
    },
  },
}),
```

**LinkedIn OIDC quirks — budget for these if the built-in defaults fail** (the one genuine unknown; `node_modules` is not installed in this worktree so the exact built-in shape can't be introspected here — verify at execution time after `npm install`):

- **Token endpoint auth method:** LinkedIn requires the client secret in the POST body, i.e. `client: { token_endpoint_auth_method: "client_secret_post" }`. The Auth.js built-in provider is expected to set this; if the token exchange 401s, add it explicitly.
- **Checks:** LinkedIn historically does **not** support PKCE. Keep `checks: ["state"]` (add `"nonce"` only if the OIDC flow demands it). Do **not** add `"pkce"`.
- **Issuer/wellKnown override (fallback):** if discovery misbehaves, set
  `issuer: "https://www.linkedin.com/oauth"` and
  `wellKnown: "https://www.linkedin.com/oauth/.well-known/openid-configuration"`.

Add a `linkedin` branch to the `jwt` callback (alongside the discord/github branches, ~`auth.ts:271-332`). OIDC claims available: `profile.sub`, `profile.name`, `profile.given_name`, `profile.family_name`, `profile.picture`, `profile.email`, `profile.email_verified`.

```ts
} else if (account.provider === "linkedin") {
  token.name = `${profile.name}`;
  token.picture = `${profile.picture}`;
  if (userId) {
    upsertAuthProfile(userId, "linkedin", {
      email: profile.email as string | undefined,
      linkedin: {
        id: String(profile.sub),
        name: profile.name as string | undefined,
        givenName: profile.given_name as string | undefined,
        familyName: profile.family_name as string | undefined,
        picture: profile.picture as string | undefined,
        email: profile.email as string | undefined,
      },
      linkedinProfile: profile as Record<string, unknown>,
    }).catch((err) => console.error("Failed to upsert LinkedIn profile:", err));
  }
}
```

The existing `signIn` callback (`auth.ts:199-220`) already gates on the email allowlist; LinkedIn returns an email, so it is covered with no change. (Unlike Strava, LinkedIn is **not** exempted from the allowlist.)

### 2. Env → config — `src/config/index.ts`

Add to the `providers` block (`~index.ts:94-107`):

```ts
linkedin: {
  clientId: process.env.AUTH_LINKEDIN_CLIENT_ID,
  clientSecret: process.env.AUTH_LINKEDIN_CLIENT_SECRET,
},
```

### 3. AuthProfile entity — `src/entities/auth-profile.ts`

- Add a `linkedin` map attribute mirroring `github`:
  `{ id: string, name: string, givenName: string, familyName: string, picture: string, email: string, linkedAt: number }`.
- Add a `linkedinProfile: { type: "any" }` attribute.
- Add `export type LinkedInProfile = { id: string; name?: string; givenName?: string; familyName?: string; picture?: string; email?: string }`.
- Extend the `upsertAuthProfile` provider union to include `"linkedin"`, add `linkedin?`/`linkedinProfile?` to the `data` param, add the name/picture computation branch (`name = data.linkedin.name`, `picture = data.linkedin.picture`), and the `payload.linkedin = { ...data.linkedin, linkedAt: now }` + `payload.linkedinProfile` blocks.
- Update the entity doc comment listing cached providers.

### 4. OIDC claims — `src/config/oidc.ts`

In `findAccount` (`~oidc.ts:360-404`):
- `result.name` fallback chain: append `|| profile.linkedin?.name`.
- `result.picture` fallback chain: append `|| profile.linkedin?.picture`.
- `result.email` fallback chain: append `|| profile.linkedin?.email`.
- `linked_providers`: add `if (profile.linkedin?.id) linkedProviders.push("linkedin");`.

### 5. Profile API — `src/app/api/profile/route.ts`

Add a `linkedin` block to `linkedAccounts` mirroring the github block (`~route.ts:52-66`): `linked`, `name`, `givenName`/`familyName`, `avatarUrl` (picture), masked `email`, `linkedAt`. The profile *page* card is deferred; the API field is added for completeness/parity.

### 6. UI — sign-in buttons

- **`src/app/(authlogin)/login/page.tsx`:** import `FaLinkedin` from `react-icons/fa`; add a LinkedIn `Button` in the OAuth row (`~page.tsx:273-298`) calling `signIn('linkedin', { callbackUrl: oidcInteraction ? ... : ... })` with the same callbackUrl logic as Discord/GitHub.
- **`src/components/header/dropdown-login.tsx`:** import `FaLinkedin`; add a `DropdownItem key="c1"` in the "OAuth Provider" section (`~dropdown-login.tsx:73-90`) calling `signIn('linkedin', { callbackUrl })`.

### 7. Deployment wiring (env → SSM)

- **`apps/run.auth/webapp/from-aws.tmpl`:** add two lines (local dev, us-east-1 store):
  ```
  AUTH_LINKEDIN_CLIENT_ID=arn:aws:ssm:us-east-1:427284555693:parameter/defcon.run/auth/linkedin/id
  AUTH_LINKEDIN_CLIENT_SECRET=arn:aws:ssm:us-east-1:427284555693:parameter/defcon.run/auth/linkedin/secret
  ```
- **Deployed ECS task secrets** — add two `valueFrom` entries pointing at the per-region store `/dc34/secrets/{region}/linkedin/client_id|client_secret`:
  ```hcl
  { name = "AUTH_LINKEDIN_CLIENT_ID",     valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/linkedin/client_id" },
  { name = "AUTH_LINKEDIN_CLIENT_SECRET", valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/linkedin/client_secret" },
  ```
  **Source-of-truth check (resolve during execution):** the `AUTH_DISCORD_*` entries appear in **both** `infra/terraform/live/site/services/run.auth/service.hcl` and the configui generator `apps/local/configui/templates/services/run.auth.service.hcl.tmpl`. Determine which is authored vs generated and edit the authored one (regenerate if needed) so they don't drift. If they are hand-kept in parallel, edit both.

## Testing

- **Unit:** extend `auth-profile` tests for the new `"linkedin"` union member and the `linkedin` map upsert (name/picture computation, `linkedAt`). Run with Node ≥ 22.12 (`nvm use 23.6.0` before `npx vitest` — default Node fails to start vitest and looks like a test failure).
- **Local E2E (optional this pass):** run `run.auth` on `:3002` against the dev LinkedIn app; sign in; confirm account creation, `AuthProfile.linkedin.id` set, and `linked_providers` includes `"linkedin"`. Suite at `apps/run.auth/e2e`.
- **Build:** `npm run build` in `apps/run.auth/webapp` (typecheck catches the union/entity changes).

## Runbook (operator — manual steps around the code)

1. **Portal (done):** LinkedIn app + Page + OIDC product + 3 redirect URLs.
2. **SSM (done):** 4 params (+2 optional local-dev).
3. **Verify secrets resolve** (names only, not values) once creds land:
   `aws ssm get-parameters-by-path --region us-east-1 --path /dc34/secrets/use1/linkedin --query "Parameters[].Name" --output text`
   and the same for `--region ca-central-1 --path /dc34/secrets/cac1/linkedin`.
4. **Deploy** `run.auth` to both regions (build + push + terragrunt apply / force-new-deployment). The new `service.hcl` secrets entries require a task-definition update, so a plain image bump is not enough — the task def must pick up the new `valueFrom`s.
5. **Prod smoke:** sign in with LinkedIn on `auth.defcon.run`; confirm account + downstream token to run.human.

## Rollback

- **Code:** the change is additive (a new provider). Removing the LinkedIn button + provider entry disables it without affecting other providers.
- **Secrets:** leaving SSM params in place is harmless.
- If the LinkedIn token exchange misbehaves in prod, hide the button (UI-only revert) while the provider config is corrected — other providers are unaffected.

## Risks / open questions

1. **Built-in provider shape (primary unknown):** exact `next-auth/providers/linkedin` config in this beta build is unverified here (deps not installed). Mitigation: the `client_secret_post` / `checks` / `issuer` overrides above are pre-identified; verify after `npm install` during execution.
2. **`service.hcl` vs configui template drift:** resolve which is source-of-truth before editing (see §7).
3. **localhost redirect:** LinkedIn may reject `http://localhost`; local dev falls back to the two prod URLs only, which is acceptable (local sign-in via LinkedIn optional).
4. **Email allowlist:** if `AUTH_ALLOWED_EMAILS` is restrictive in prod, LinkedIn logins are subject to it like any other login — intended, but worth confirming the allowlist expectation before smoke-testing.
