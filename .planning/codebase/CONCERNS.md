# Codebase Concerns

**Analysis Date:** 2026-02-28

## Security Gaps

**Missing Rate Limiting on Auth Endpoints:**
- Issue: No rate limiting on authentication endpoints (login, CSRF token generation, OTP verification, OAuth callbacks)
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts`, `apps/run.auth/webapp/src/app/api/(authlogin)/login/page.tsx`, `apps/run.auth/webapp/src/app/api/captcha/challenge/route.ts`
- Impact: Vulnerable to brute force attacks on email OTP, CSRF token replay, and account enumeration despite ALTCHA proof-of-work captcha
- Current mitigation: ALTCHA PoW captcha on login, in-memory LRU challenge dedup (2-minute TTL)
- Recommendations: Implement AWS WAF rate limiting rules per IP (suggest 5 login attempts per minute per IP), add request-level rate limiting middleware, enforce stricter CSRF token rotation

**Session Invalidation Not Enforced:**
- Issue: `sessionVersion` field exists in AuthProfile but is not enforced during JWT validation on downstream services
- Files: `apps/run.auth/webapp/src/app/api/admin/user/[userId]/lock/route.ts`, `apps/run.auth/webapp/src/app/api/session/validate/user/[userId]/route.ts`, downstream services
- Impact: Locked users, invalidated sessions can continue operating if they cache JWTs; no real-time revocation
- Current mitigation: Session validation runs every 5 minutes in services, increments sessionVersion on lockout
- Recommendations: Query sessionVersion on every request or use shorter JWT TTL (currently 1 hour), implement real-time session invalidation via Redis/DynamoDB streams, add middleware validation on all protected routes

**Dangerous Email Account Linking Enabled:**
- Issue: `allowDangerousEmailAccountLinking=true` in Auth.js OAuth providers (Discord, GitHub)
- Files: `apps/run.auth/webapp/node_modules/@auth/core/providers/oauth.d.ts` (bundled, not in source)
- Impact: Users can link accounts by sharing email across providers; no email verification required for OAuth-provider account link
- Recommendations: Implement email verification step before account linking, add confirmation modal, log all account link events, consider disabling for production

**CSRF Token Delimiter Confusion:**
- Issue: Code checks both `|` and `%7C` (URL-encoded pipe) delimiters: `const delim = csrfCookie.indexOf("|") !== -1 ? "|" : "%7C";`
- Files: `apps/run.auth/webapp/src/app/api/login/route.ts` line 54
- Impact: Security unclear - comment says "Remember why I did this..." suggesting unresolved cookie encoding issue
- Recommendations: Document why both delimiters are needed, consider normalizing to single delimiter, add test for both paths

---

## Known Bugs

**GPX Auto-Save Interval Hardcoded for Testing:**
- Issue: Auto-save interval set to 1 minute for testing, not 10 minutes for production
- Files: `apps/run.gpx/gpx-studio/website/src/lib/auto-save.ts` line 18-19
- Trigger: Auto-save constantly runs, consuming S3 and DynamoDB quota heavily
- Workaround: Manually disable auto-save or rebuild frontend
- Recommendations: Restore to `dev ? 1 * 60 * 1000 : 10 * 60 * 1000` before deployment

**CMS Admin Hard-coded Domain:**
- Issue: Strapi admin page hard-codes `siteDomain = 'defcon.run'` instead of reading from config
- Files: `apps/run.cms/app/src/admin/app.tsx` line 65
- Impact: Cannot use dev/staging domains for admin auth redirects; SSO region prefix handling breaks on non-production domains
- Recommendations: Inject via Strapi config environment variable, use `process.env.NEXT_PUBLIC_SITE_DOMAIN` or similar

---

## Fragile Areas

**CMS Master/Replica Replication:**
- Files: `apps/run.cms/app/scripts/db-push.sh`, service config for cms-master/cms-worker
- Why fragile: Litestream replication relies on continuous `litestream replicate` process in master (us-east-1 only); workers restore every 5 minutes via `litestream-sync.sh`. If master fails mid-replication, workers may miss writes. If S3 restoration fails silently, replicas become stale without alerting.
- Safe modification: Add monitoring for litestream process health, implement S3 restore validation (checksum verification), add explicit error handling in db-push.sh timeout logic, test failover scenarios with master down
- Test coverage: No automated tests for replication failures; manual verification only

**GPX Studio Vendored Build:**
- Files: `apps/run.gpx/gpx-studio/`, `apps/run.gpx/build-frontend.sh`
- Why fragile: Vendored SvelteKit codebase requires separate build step (`build-frontend.sh`) before Docker build; Next.js basePath routing uses region prefix but gpx-studio was not originally built with path awareness
- Safe modification: Document build dependency clearly, add pre-flight check in build.sh that fails if gpx-studio isn't built, test region routing with real CloudFront path prefix
- Test coverage: No integration tests for region-prefixed routes

**Strapi Plugin SSO Region Handling:**
- Files: `apps/run.cms/app/src/admin/app.tsx` (browser-side redirects)
- Why fragile: Complex region-aware URL construction in browser context; nginx rewrites `/{region}/strapi-plugin-sso/*` to `/strapi-plugin-sso/*` on CMS service, but admin.tsx must construct correct URLs for localhost (no region) vs production (with region)
- Safe modification: Add integration test for region redirects (local + production), test with invalid region paths, verify nginx rewrite rules in terraform
- Test coverage: Not tested; manual verification during deployment only

---

## Performance Bottlenecks

**Session Validation Every 5 Minutes:**
- Problem: Every request to downstream services (run.human, run.gpx) validates session against auth server
- Files: All downstream services check `sessionVersion` against `run.auth` API
- Cause: No local caching; distributed system requires real-time session state verification
- Impact: Adds ~100-500ms to request latency, potential auth server bottleneck under load
- Improvement path: Cache session state locally with 30-60 second TTL, implement WebSocket push for session invalidation, use DynamoDB Streams for reactive updates, consider JWT self-contained claims for stateless validation

**CloudFront Origin Router Path-Based Routing:**
- Problem: Single CloudFront distribution routes `/{region}/*` prefixes to regional ALBs; all 3 regions share single distribution
- Files: `infra/terraform/modules/cloudfront/v1.0.0/main.tf`
- Cause: Cascading origin failover means region 2/3 requests hit region 1 first if region 1 is slow
- Impact: Single-region latency spike affects all regions; no graceful regional failover
- Improvement path: Use separate CloudFront distributions per region with Route53 geoproximity routing, implement origin health checks with fast failover, monitor origin response times

**DynamoDB Global Tables Eventual Consistency:**
- Problem: RunUser and Quota data replicated across regions with eventual consistency
- Files: `infra/terraform/modules/dynamodb/v1.0.0/main.tf`, services that read/write user data
- Cause: Global Tables v2 eventual consistency model (milliseconds to seconds)
- Impact: Can create race conditions where user sees stale quota in one region but updated quota in another
- Improvement path: Use strong consistency for quota reads (costs more), implement client-side deduplication of quota consume requests, add idempotency keys

---

## Test Coverage Gaps

**E2E Tests Only for Auth Service:**
- What's not tested: run.human, run.gpx, run.cms end-to-end flows; quota system under load; multi-region failover; session invalidation on lockout
- Files: `apps/run.auth/e2e/` exists; `apps/run.human/`, `apps/run.gpx/`, `apps/run.cms/` have no e2e tests
- Risk: Cannot verify authentication-dependent features work across regions; quota bugs go undetected; session revocation not validated
- Priority: High

**No Load Testing for Quota System:**
- What's not tested: Concurrent quota consume requests from multiple regions; quota tier upgrades under load; stale quota cleanup behavior
- Files: Quota logic scattered across `apps/run.auth/webapp/src/services/quota.ts` and route handlers
- Risk: Race conditions in quota updates; deadlock between consume/restore operations not detected
- Priority: Medium

**Missing GPX Region Routing Tests:**
- What's not tested: CloudFront path prefix routing to regional ALBs; next.js basePath with region prefix; gpx-studio access from different regions
- Files: `apps/run.gpx/`, no integration tests for region routing
- Risk: Deploy with broken region routing; users cannot access gpx editor from non-primary region
- Priority: Medium

**No CMS Replication Failure Tests:**
- What's not tested: Master replication failure scenarios; worker restoration from stale S3 snapshot; litestream process crash recovery
- Files: `apps/run.cms/app/scripts/`, terraform cms service definitions
- Risk: Silent data loss; workers serving stale content indefinitely
- Priority: High

**Strapi Plugin SSO Logout Not Tested:**
- What's not tested: End-to-end logout flow through OIDC end_session endpoint; post-logout redirect behavior; session cleanup
- Files: `apps/run.cms/app/src/admin/app.tsx` (logout redirect), no playwright tests
- Risk: Users may remain logged in after logout; residual sessions leak data
- Priority: Medium

---

## Scaling Limits

**Auth JWT Secret Rotation:**
- Current capacity: Supports multiple JWT secrets via `AUTH_JWT_SECRET.split(",")` for rolling rotation
- Limit: Rotation can only be done via environment variable update + service restart; no hot reload
- Scaling path: Implement JWT secret versioning in DynamoDB with `kid` header for stateless rotation, add health check that alerts if all secrets expired

**Strapi SQLite + Litestream:**
- Current capacity: Single SQLite database in us-east-1 with Litestream S3 replication
- Limit: SQLite write throughput ~1000-5000 writes/sec on t3.medium; highly concurrent writes cause contention; Litestream replication adds ~50-100ms latency
- Scaling path: Migrate from SQLite to RDS PostgreSQL for genuine multi-region writes, implement event streaming (Kinesis) for content change notifications, consider DynamoDB for high-throughput read-heavy content

**CloudFront Distribution Share Point:**
- Current capacity: Single CloudFront distribution for all 5 services and 3 regions; single origin picker
- Limit: 25,000 requests/sec per distribution (soft limit); complex routing rules add latency
- Scaling path: Separate distributions per service domain (auth.defcon.run, run.defcon.run, etc.) with independent caching, use Route53 weighted routing for regional failover

**ECS Task Density:**
- Current capacity: Defaults to 1 vCPU/512MB tasks for Next.js apps; no horizontal scaling limits defined
- Limit: ALBs default to 1000 requests/min per target; no auto-scaling policies documented
- Scaling path: Add ECS auto-scaling policies based on CPU/memory/ALB request count, implement horizontal pod autoscaling, increase ALB target group connection limits

**DynamoDB Global Tables Write Limit:**
- Current capacity: Global Tables replicate writes across 3 regions; each region writes to local replica
- Limit: Hot partition writes (e.g., quota updates for same user) throttle at 1000 WCU per partition; cross-region replication adds 50-100ms latency
- Scaling path: Implement write sharding by user ID hash, use DynamoDB streams for fan-out writes, consider eventual consistency with conflict resolution

---

## Dependencies at Risk

**Strapi 5.6 Recently Released:**
- Risk: Strapi 5 is brand new (Feb 2025); breaking API changes still occurring; plugin ecosystem immature
- Impact: strapi-plugin-sso may have undiscovered bugs; migration to v6 may require rewriting plugins
- Mitigation: Lock package-lock.json strictly, monitor Strapi security advisories, maintain local fork of strapi-plugin-sso
- Migration plan: Evaluate move to Headless CMS alternatives (Payload CMS, Sanity) if Strapi 5 proves unstable

**oidc-provider v9 Custom Implementation:**
- Risk: Custom OIDC provider built on top of oidc-provider library; OAuth server implementation details tightly coupled
- Impact: Upgrading oidc-provider requires careful testing of all OAuth flows; custom claims delivery not standard
- Mitigation: Document all custom OIDC modifications, add integration tests for OAuth token generation, lock oidc-provider version
- Migration plan: Consider moving to Auth0, Keycloak, or AWS Cognito if complexity becomes unmanageable

**ElectroDB Entity Modeling:**
- Risk: Custom ElectroDB entities for AuthProfile, RunUser, Quota; schema updates require careful migration
- Impact: Breaking schema changes cannot be rolled back without downtime; no built-in migration tooling
- Mitigation: Schema is versioned in entity definitions; maintain backward compatibility when adding fields
- Migration plan: DynamoDB native querying as fallback if ElectroDB becomes limiting

---

## Architectural Debt

**Multi-Region Routing Complexity:**
- Issue: Three separate region routing layers: CloudFront path prefix → ALB path routing → Next.js basePath + nginx rewriting
- Files: `infra/terraform/modules/cloudfront/`, service definitions, nginx configs embedded in task definitions
- Impact: Hard to trace bugs; changes to routing require coordination across all three layers
- Recommendations: Consolidate routing decisions into single source of truth (e.g., CloudFront only), simplify nginx config to simple proxy without path rewriting, document routing path with diagrams

**Quota Tier System Not Exposed in API:**
- Issue: Quota tier upgrade happens via admin API only; no way for users to view or request upgrades
- Files: `apps/run.auth/webapp/src/app/api/admin/quota/upgrade-tier/route.ts`
- Impact: Users cannot self-serve; all quota changes require admin intervention; no audit trail visible to users
- Recommendations: Add user-facing API to view quotas, implement quota request/approval workflow, add quota usage dashboard in run.human

**Hardcoded Strava as "Account Linking Only":**
- Issue: Strava OAuth configured but explicitly disabled as login method; only account linking allowed
- Files: `apps/run.auth/webapp/src/app/(authlogin)/strava/page.tsx`, auth config
- Impact: User confusion; asymmetric OAuth handling compared to Discord/GitHub
- Recommendations: Document why Strava is link-only, consider enabling as login method if needed, or remove entirely

---

## Missing Critical Features

**No User-Facing Audit Log:**
- Problem: Authentication events logged server-side but not exposed to users; users cannot see login history, IP addresses, or devices
- Impact: Users cannot verify account compromise; no visibility into unauthorized access
- Recommendations: Add audit log viewer in user profile, implement alert on unusual login from new IP/device, expose via API

**No Rate Limit Status Feedback:**
- Problem: When users hit WAF rate limits, they get generic 403 responses without guidance
- Impact: Users don't know if rate limit is temporary or permanent; no way to check remaining quota
- Recommendations: Return `X-RateLimit-*` headers in WAF responses, implement rate limit dashboard, add retry-after header

**No Graceful Degradation for CMS Master Failure:**
- Problem: If CMS master crashes, workers cannot write new content; no fallback
- Impact: Content updates blocked until master recovers; no read-only mode option
- Recommendations: Implement RDS failover for CMS master, use read-only replicas until write capacity restored, add operational runbook

---

## Infrastructure Code Quality

**Terraform Modules Too Granular:**
- Issue: 20 separate modules with deep nesting; templating logic spread across multiple layers
- Files: `infra/terraform/modules/`, `infra/terraform/live/site/`
- Impact: Hard to reason about full stack; changes to module variables ripple across many files
- Recommendations: Consolidate related modules (e.g., ecs-task + ecs-service + ecs-cluster into single module), reduce nesting depth

**Litestream Sync Script Error Handling:**
- Issue: `litestream-sync.sh` uses `|| true` to ignore restoration failures
- Files: `apps/run.cms/app/scripts/litestream-sync.sh`
- Impact: Failed restores go undetected; workers silently serve stale data
- Recommendations: Log failures explicitly, implement retry with exponential backoff, alert on persistent failures

---

## Deployment Risks

**Release Script Complexity:**
- Issue: `apps/release-all.sh` performs 15+ sequential steps: version bumping, Docker builds, ECR pushes, PR creation, Terragrunt apply
- Files: `apps/release-all.sh`
- Impact: Single point of failure during multi-region release; partial deployments possible; manual recovery required
- Recommendations: Break into atomic stages, implement idempotency checks, add dry-run mode, implement automatic rollback on terraform apply failure

**CloudFront Distribution IDs Fetched at Release Time:**
- Issue: `release-all.sh` fetches CloudFront distribution IDs dynamically; if lookup fails, cache invalidation silently skipped
- Files: `apps/release-all.sh` lines 594-596
- Impact: Old cached content served after deployment; users see stale UI
- Recommendations: Cache distribution IDs in terraform outputs, verify before invalidation, fail if distribution not found

**Manual Secrets Rotation:**
- Issue: All secrets managed via SSM Parameter Store; rotation requires manual SOPS key management and terraform apply
- Files: `infra/terraform/modules/secrets/v1.0.0/`, `.secrets.sops.json`
- Impact: No automated rotation; expired secrets not rotated until manual intervention
- Recommendations: Implement AWS Secrets Manager with auto-rotation, set up SNR Lambda triggers for rotation

---

*Concerns audit: 2026-02-28*
