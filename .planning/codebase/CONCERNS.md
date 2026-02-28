# Codebase Concerns

**Analysis Date:** 2026-02-28

## Tech Debt

**Duplicate `sanitizeRadio` function across route files:**
- Issue: Identical `sanitizeRadio()` function is copy-pasted in two files
- Files: `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts` (line 10), `apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts` (line 7)
- Impact: Any fix must be applied in both places or they drift apart
- Fix approach: Extract to shared utility in `apps/run.human/webapp/src/lib/meshtastic-utils.ts`

**Insecure random number generation for security-sensitive codes:**
- Issue: Meshtastic radio verification codes and auth verification tokens use `Math.random()` instead of `crypto.getRandomValues()` or `crypto.randomInt()`
- Files: `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts` (line 125), `apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts` (line 70), `apps/run.auth/webapp/src/config/auth.ts` (line 165)
- Impact: `Math.random()` is not cryptographically secure. Verification codes are predictable if the PRNG state is known. For a DEF CON event where adversarial participants are expected, this matters.
- Fix approach: Replace `Math.floor(100000 + Math.random() * 900000)` with `crypto.randomInt(100000, 1000000)`. Replace `Math.floor(Math.random() * alphabet.length)` with `crypto.randomInt(alphabet.length)`.

**GPX auto-save interval hardcoded to test value:**
- Issue: Auto-save interval is hardcoded to 1 minute for all environments. A TODO says to change back to a conditional expression but the change was not applied.
- Files: `apps/run.gpx/gpx-studio/website/src/lib/auto-save.ts` (lines 17-19)
- Impact: Production users get 1-minute auto-save instead of 10-minute, which consumes save quota faster and generates more S3 writes
- Fix approach: Change line 19 to `const AUTO_SAVE_INTERVAL = dev ? 1 * 60 * 1000 : 10 * 60 * 1000;`

**In-memory Altcha challenge replay cache does not survive restarts:**
- Issue: The `usedChallenges` Map for Altcha proof-of-work replay prevention lives in Node.js process memory
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts` (lines 14-25)
- Impact: On container restart or in multi-instance deployments (currently 1 per region), challenges solved before the restart can be replayed. The 2-minute TTL limits exposure, but multi-region deployments mean a challenge solved in one region can be replayed in another.
- Fix approach: Acceptable risk given the short TTL and the fact that each region runs a separate instance. Consider DynamoDB-based challenge tracking only if abuse is observed.

**CSRF token delimiter workaround with unexplained TODO:**
- Issue: `TODO: Remember why I did this...` on line 54 indicates unclear logic
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts` (line 54)
- Impact: Fragile code with unclear reasoning. Could mask a URL encoding bug.
- Fix approach: Investigate and document why both `|` and `%7C` delimiters are checked, or simplify if the root cause is understood.

**No unit test framework configured:**
- Issue: No Jest, Vitest, or other unit test configuration exists anywhere in the monorepo. All testing relies on Playwright e2e tests.
- Files: Only test files: `apps/run.auth/e2e/tests/`, `apps/run.gpx/e2e/cloud-storage.spec.ts`
- Impact: Business logic in entities (`run-user.ts`, `auth-profile.ts`), quota service (`quota.ts`), and API routes has zero unit test coverage. Regressions can only be caught by e2e tests or manual testing.
- Fix approach: Add Vitest to `apps/run.human/webapp` and `apps/run.auth/webapp`. Prioritize unit tests for `apps/run.auth/webapp/src/services/quota.ts` and `apps/run.human/webapp/src/entities/run-user.ts`.

**CMS hardcoded domain in client-side code:**
- Issue: `defcon.run` is hardcoded in `app.tsx` for the CMS Strapi admin panel because process.env is unavailable in browser context
- Files: `apps/run.cms/app/src/admin/app.tsx` (line 65)
- Impact: The CMS admin panel cannot be deployed to a different domain without code changes. Low risk since the domain is unlikely to change, but it is a maintenance concern.
- Fix approach: Inject the domain via Strapi server config and expose it to the admin panel, or accept the hardcoding for this project.

## Known Bugs

**Meshtastic verification codes are never actually delivered:**
- Symptoms: When a user registers a Meshtastic radio, a verification code is generated but only logged to `console.log`. The code is never sent to the actual Meshtastic radio device.
- Files: `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts` (line 128), `apps/run.human/webapp/src/app/api/meshtastic-radios/resend/route.ts` (line 73)
- Trigger: Any user adding a Meshtastic radio. The UI shows "A verification code was sent to your radio" but no message was sent.
- Workaround: An operator must read the server logs to obtain the code and relay it manually, or implement actual Meshtastic mesh messaging integration.

**Invite code reflected in error response:**
- Symptoms: When an invalid invite code is submitted, the error response includes the submitted value verbatim: `Invalid invite code: '${inviteCode}'`
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts` (line 129)
- Trigger: Submit any login with an invalid invite code
- Workaround: Change error to generic message: `"Invalid invite code"` without reflecting input

**Non-AuthError objects serialized via JSON.stringify in login error response:**
- Symptoms: If the `signIn()` call throws an error that is not an `AuthError`, the raw error is JSON-serialized and returned to the client
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts` (line 147)
- Trigger: Any unexpected error during the nodemailer sign-in flow
- Workaround: Replace `JSON.stringify(error)` with a generic error message to prevent information disclosure

## Security Considerations

**`allowDangerousEmailAccountLinking` enabled on all OAuth providers:**
- Risk: This Auth.js flag allows any OAuth provider (GitHub, Discord, Strava) to link to an existing account by email match alone, without verifying that the user owns both accounts. An attacker who controls a GitHub/Discord account with a victim's email could gain access to the victim's account.
- Files: `apps/run.auth/webapp/src/config/auth.ts` (lines 107, 125, 144), `apps/run.human/webapp/src/config/auth.ts` (line 101)
- Current mitigation: Email verification through nodemailer is required for initial account creation. ALTCHA proof-of-work prevents automated attacks. Invite codes limit signups during pre-event phase.
- Recommendations: This is a deliberate design choice for user convenience (linking social accounts easily). Document the risk. Consider disabling for Strava if it truly has "no email by design" (line 201 in auth config suggests this).

**Non-timing-safe secret comparison for internal API authentication:**
- Risk: All `X-Internal-Secret` header checks use JavaScript `!==` comparison, which is not timing-safe and theoretically vulnerable to timing attacks
- Files: `apps/run.auth/webapp/src/app/api/session/validate/user/[userId]/route.ts` (line 56), `apps/run.auth/webapp/src/app/api/session/validate/token/route.ts` (line 43), plus ~15 other admin/internal routes
- Current mitigation: These endpoints are internal (service-to-service via ECS service discovery), not exposed to the public internet via CloudFront
- Recommendations: Use `crypto.timingSafeEqual()` for all secret comparisons. Low urgency given network isolation.

**SSH security group allows 0.0.0.0/0 on port 22:**
- Risk: SSH is open to the entire internet on the `sshhttps` security group
- Files: `infra/terraform/modules/network/v1.0.0/securitygroups.tf` (line 28)
- Current mitigation: ECS Fargate tasks do not have SSH. This SG appears to be for EC2 spot instances (configui, waffaw) which may need temporary access.
- Recommendations: Restrict to a specific IP CIDR or use AWS Systems Manager Session Manager instead of SSH.

**MQTT port 1883 (unencrypted) open to 0.0.0.0/0:**
- Risk: The NLB security group allows plaintext MQTT (port 1883) from anywhere on the internet
- Files: `infra/terraform/modules/network/v1.0.0/securitygroups.tf` (lines 189-196)
- Current mitigation: TLS MQTT (port 8883) is also available. MQTT credentials are per-user.
- Recommendations: Consider removing port 1883 ingress and requiring TLS-only MQTT connections.

**MQTT credentials derived from deterministic hash:**
- Risk: MQTT username and password are derived from `SHA256(userId + seed)` and `SHA256(mqttUsername + seed)`. If the `RUN_USER_CREATION_SEED` is known, all credentials can be reconstructed from userIds.
- Files: `apps/run.human/webapp/src/entities/run-user.ts` (lines 7, 217-227)
- Current mitigation: The seed is stored in environment variables (not hardcoded in production). Default value `"default-seed"` only applies in development.
- Recommendations: Verify production has a strong, unique seed set via `RUN_USER_CREATION_SEED`. Consider switching to `crypto.randomBytes()` for MQTT passwords (not derived from seed).

**Meshtastic private keys stored in plaintext in DynamoDB:**
- Risk: Users' Meshtastic radio private keys are stored as plaintext strings in DynamoDB
- Files: `apps/run.human/webapp/src/entities/run-user.ts` (line 79), `apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts` (line 133)
- Current mitigation: DynamoDB uses encryption at rest (KMS). API strips verification codes but returns private keys to the authenticated user.
- Recommendations: Consider encrypting private keys with a per-user key before storage, or clarify that these are Meshtastic protocol keys that users already have access to.

## Performance Bottlenecks

**OIDC tokens accumulate without DynamoDB TTL cleanup:**
- Problem: The `run-auth-electro` DynamoDB table stores OIDC tokens (AccessToken, AuthorizationCode, RefreshToken, Session, Grant, Interaction) with `ttl_enabled = false`
- Files: `infra/terraform/live/site/services/run.auth/service.hcl` (lines 302-304), `apps/run.auth/webapp/src/entities/oidc-adapter.ts` (lines 64-66)
- Cause: OIDC adapter sets `expiresAt` on records and checks it in application code (line 91-96), but DynamoDB never deletes expired records. Records grow unboundedly.
- Improvement path: Enable TTL on `run-auth-electro` table with `expiresAt` as the TTL attribute. Note: The `expiresAt` field uses seconds-since-epoch (line 65), which is the correct format for DynamoDB TTL.

**DynamoDB item size risk from unbounded `checkIns` list:**
- Problem: The `RunUser` entity stores GPS check-ins as a list attribute on the user item. DynamoDB items have a 400KB limit.
- Files: `apps/run.human/webapp/src/entities/run-user.ts` (lines 92-114)
- Cause: The `checkIns` list grows with every check-in. Each check-in includes GPS samples, coordinates, and user agent string. No API endpoint exists yet, but the data model allows unbounded growth.
- Improvement path: When implementing check-in API, store check-ins as separate DynamoDB items (one per check-in) rather than as a list on the user item. Or enforce a maximum list size.

**DynamoDB item size risk from `meshtasticRadios` list:**
- Problem: Meshtastic radios are stored as a list on the user item. While the quota limits to 5 adds (lifetime), each radio includes a base64-encoded private key.
- Files: `apps/run.human/webapp/src/entities/run-user.ts` (lines 72-90)
- Cause: Read-modify-write pattern for the entire radios list on every operation
- Improvement path: The 5-radio lifetime limit keeps this manageable. No immediate action needed, but consider separate items if radio data grows.

## Fragile Areas

**OIDC adapter GSI eventual consistency workaround:**
- Files: `apps/run.auth/webapp/src/entities/oidc-adapter.ts` (lines 124-165)
- Why fragile: The `findByUid` method uses a multi-step lookup strategy (direct primary key, then GSI, then re-fetch with ConsistentRead) to work around DynamoDB GSI eventual consistency. This was added to fix SessionNotFound errors. The triple-lookup pattern is complex and could mask other issues.
- Safe modification: Do not remove the ConsistentRead calls. If changing the OIDC adapter, test with multi-region deployment to verify GSI replication timing.
- Test coverage: Covered by e2e auth tests (`apps/run.auth/e2e/tests/session-valid.spec.ts`) but no unit tests for the adapter itself.

**CMS Strapi admin fetch() monkey-patching:**
- Files: `apps/run.cms/app/src/admin/app.tsx` (lines 126-178)
- Why fragile: The bootstrap function replaces `window.fetch` globally to intercept 401 responses and logout requests. This is fragile because Strapi admin panel upgrades could change API patterns, and the monkey-patch could interfere with other browser extensions or libraries.
- Safe modification: Test any Strapi version upgrade thoroughly. Verify that logout interception still works after updating strapi-plugin-sso.
- Test coverage: No automated tests. Manual testing required.

**Multi-region OIDC redirect URI management:**
- Files: `apps/run.auth/webapp/src/config/oidc.ts` (lines 22-117)
- Why fragile: OIDC client redirect_uris are hardcoded with all permutations of region prefixes (use1, cac1), with and without basePath. Adding a new region requires updating 3 client configurations with multiple URL variants. Missing a URL variant causes auth failures in specific regions.
- Safe modification: When adding a new region, add redirect URIs for all 3 clients. Test login flow in the new region.
- Test coverage: E2e tests run against a single region.

**Silent SSO flow depends on cross-service cookie validation:**
- Files: `apps/run.human/webapp/src/app/(public)/layout.tsx` (lines 18-53)
- Why fragile: The public layout checks for a `sess_auth` cookie (from auth.defcon.run), sends it to the auth server's internal validate endpoint, and auto-redirects to OIDC login if valid. This creates a dependency chain: cookie presence -> internal API call -> redirect -> OIDC flow. Any failure in the chain silently falls through (no error shown to user), but a misconfigured internal URL causes repeated failed validation calls on every page load.
- Safe modification: Ensure `AUTH_INTERNAL_URL` and `AUTH_INTERNAL_SECRET` are set correctly in all environments.
- Test coverage: Not covered by e2e tests.

## Scaling Limits

**ECS desired_count set to 1 per region:**
- Current capacity: Single task per service per region
- Limit: No horizontal scaling. If the single task OOMs or is killed, the service is down until ECS restarts it (30-120 seconds based on health check config).
- Scaling path: Increase `desired_count` in service.hcl. The applications are stateless (JWT sessions, DynamoDB backend) and can scale horizontally. Exception: run.cms uses SQLite with Litestream, which requires leader election for writes.

## Dependencies at Risk

**OIDC cookie key defaults to insecure value:**
- Risk: `apps/run.auth/webapp/src/config/index.ts` (line 58) defaults to `["oidc-dev-key-change-me"]` if `OIDC_COOKIE_KEYS` env var is not set
- Impact: If production somehow runs without this env var, OIDC session cookies use a known key, allowing cookie forgery
- Migration plan: Verify via infrastructure deployment that `OIDC_COOKIE_KEYS` is always set in production secrets. Add a startup check that crashes the app if the default key is used in production.

**MQTT credentials fallback to `"default-seed"`:**
- Risk: `apps/run.human/webapp/src/entities/run-user.ts` (line 7) defaults `RUN_USER_CREATION_SEED` to `"default-seed"`
- Impact: If production runs without the env var, all MQTT credentials are derived from a known seed
- Migration plan: Add startup validation that rejects `"default-seed"` when `NODE_ENV=production`

## Missing Critical Features

**Meshtastic radio verification delivery not implemented:**
- Problem: The UI promises to send a 6-digit verification code to the user's Meshtastic radio, but the backend only logs the code to console. No Meshtastic mesh messaging integration exists.
- Blocks: Radio verification workflow is non-functional. Radios can be added but never verified without manual operator intervention.

**GPS check-in API not implemented:**
- Problem: The `RunUser` entity defines `checkIns`, `lastCheckInAt`, `checkInCount` fields and a `checkin` quota type, but no API route exists for creating check-ins
- Blocks: GPS check-in feature is not available to users. Data model exists but no implementation.

**Meshtastic flasher (flash.defcon.run) is design-only:**
- Problem: A comprehensive design document exists at `docs/plans/2026-02-28-meshtastic-flasher-design.md` but no application code exists in `apps/` for this feature
- Blocks: Users cannot web-flash Meshtastic radios for the event

**Waffaw (WAF testing platform) is partially built:**
- Problem: Waffaw has Playwright scenarios, a Dockerfile, and infrastructure modules (`infra/terraform/modules/waffaw/v1.0.0/`) but is not integrated into the release pipeline and has no ConfigUI integration
- Blocks: WAF testing cannot be run as an automated service

## Test Coverage Gaps

**Zero unit tests across entire codebase:**
- What's not tested: All business logic - quota service, user entity creation, OIDC adapter, meshtastic radio CRUD, GPX file management
- Files: `apps/run.auth/webapp/src/services/quota.ts`, `apps/run.human/webapp/src/entities/run-user.ts`, `apps/run.auth/webapp/src/entities/oidc-adapter.ts`, `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/route.ts`
- Risk: Regressions in quota calculation, MQTT credential generation, OIDC token lifecycle, or GPX file versioning can only be caught by e2e tests or production incidents
- Priority: High

**No e2e tests for run.human application:**
- What's not tested: Login flow, profile page, meshtastic radio CRUD, QR code generation, whoami page
- Files: `apps/run.human/webapp/src/app/` (all routes)
- Risk: UI regressions, broken auth flow, meshtastic radio management errors
- Priority: Medium

**No e2e tests for run.cms application:**
- What's not tested: SSO login flow, content CRUD, Litestream sync, admin panel customization
- Files: `apps/run.cms/app/src/admin/app.tsx`, `apps/run.cms/app/src/middlewares/services-validation.ts`
- Risk: CMS login failures, content loss on SQLite failover, broken SSO redirect
- Priority: Medium

**Silent SSO flow not tested:**
- What's not tested: The cookie-based auto-login redirect on the run.human public layout
- Files: `apps/run.human/webapp/src/app/(public)/layout.tsx` (lines 18-53)
- Risk: Users may get stuck in redirect loops or fail to auto-login when they have a valid auth session
- Priority: Low (manual testing covers this flow)

---

*Concerns audit: 2026-02-28*
