# IP Visibility (bidirectional IP ↔ user lookup) — Design

**Date:** 2026-07-12
**Service:** run.auth (`auth.defcon.run/use1/admin`)
**Status:** Approved requirements — spec for review before planning

## Problem

When an account looks abusive (token/account sharing, multi-account farming) an
admin needs to answer two questions fast, from the identity admin console:

1. **"Give me the IPs of user X"** — every IP this identity has logged in from
   (a spread of IPs, or a sudden new IP, is the token/account-sharing tell).
2. **"Give me all the users of IP Y"** — every identity that has logged in from a
   given IP (the shared-device / multi-account signal, and the reverse of #1).

That bidirectional lookup is the whole ask. Blocking an IP at the WAF edge is a
natural **follow-on**, deliberately out of scope for v1.

## The data already exists

Every login already emits a structured activity event to stdout → CloudWatch
(Phase 40, `src/lib/log-event.ts`), verified live in prod:

```json
{"evt":"auth.login","userId":"1bd4…","email":"g…@gmail.com","ip":"65.25.248.28","ua":"Chrome/149 Windows","meta":{}}
```

- Emitted at `config/auth.ts:285` (`auth.login`) and `:291` (`auth.signup`).
- `ip` = the **real client IP** (first `x-forwarded-for` hop — confirmed real
  client addresses, not CloudFront's).
- Log group `/ecs/run-auth-app-run-auth-use1-dc34`, **90-day retention**.

So `{userId, email, ip, ua, @timestamp}` per login is queryable for 90 days with
**no new data pipeline** — via CloudWatch Logs Insights.

**Granularity note:** these are *login* events (`auth.login`/`auth.signup`), not
every request. So "IPs of user X" means *the IPs they logged in from*, which is
exactly the right signal for token/account sharing (a login = a new session).
This will be stated plainly in the UI ("login IPs, last 90 days").

## Architecture

### Query layer — CloudWatch Logs Insights

A small server-only helper runs an Insights query and returns rows:

```
runInsights(queryString, startMs, endMs): Promise<Record<string,string>[]>
  1. logs.startQuery({ logGroupName, startTime, endTime, queryString })  → queryId
  2. poll logs.getQueryResults({ queryId }) until status === "Complete"
     (backoff ~400ms, cap ~10s; on timeout return partial + a flag)
  3. map results ([{field,value}]) → flat objects
```

The two queries (both filter BEFORE stats, so they scan cheaply):

**IPs of user X:**
```
fields @timestamp, ip, ua
| filter (evt="auth.login" or evt="auth.signup") and userId="X"
| stats count() as logins, earliest(@timestamp) as firstSeen,
        latest(@timestamp) as lastSeen, count_distinct(ua) as agents by ip
| sort logins desc
```

**Users of IP Y:**
```
fields @timestamp, userId, email
| filter (evt="auth.login" or evt="auth.signup") and ip="Y"
| stats count() as logins, earliest(@timestamp) as firstSeen,
        latest(@timestamp) as lastSeen by userId, email
| sort logins desc
```

Time window defaults to the last 90 days (full retention); the range is a
parameter so the UI can narrow it.

### IAM (Terraform)

The run.auth ECS task role needs CloudWatch Logs Insights read on its own log
group. Add to the run.auth service module / `services/run.auth`:

```
logs:StartQuery, logs:GetQueryResults, logs:StopQuery
  on  arn:aws:logs:us-east-1:<acct>:log-group:/ecs/run-auth-app-run-auth-use1-dc34:*
  (+ StartQuery also needs the log-group ARN without the trailing :* )
```

Scope to the run.auth log group only. No write permissions.

### API routes (session-gated, 404-on-deny, manual validation, no zod)

- `GET /api/admin/identities/[userId]/ips` → `{ ips: [{ ip, logins, firstSeen, lastSeen, agents }] }`
- `GET /api/admin/ip-lookup?ip=<ip>` → `{ users: [{ userId, email, logins, firstSeen, lastSeen }] }`
  - Validate `ip` with a simple IPv4/IPv6 shape check before interpolating into
    the query string (defense-in-depth even though it's our own log data).

Both mirror the existing admin routes: `await auth()` + `requireAdmin` +
in-process `revalidateAdmin`, denial → 404, `runtime="nodejs"`,
`dynamic="force-dynamic"`, `Cache-Control: no-store`.

### UI

Two surfaces on the existing console (PR #542 / restyle):

1. **Drawer — "login IPs" section** (per identity): on drawer open, lazily fetch
   `/identities/[userId]/ips`. Render each IP as a row: the IP (monospace),
   logins count, last-seen (recency-colored like the table), and the browser/UA.
   Each IP is **clickable → opens the IP-lookup panel for that IP** (so you jump
   straight from "user's IPs" to "who else used this IP").

2. **IP lookup panel** (top-level): a small input at the top of the console (or a
   secondary drawer) — paste an IP → shows every identity that logged in from it,
   each row linking back to that identity's drawer. This is the "users of IP Y"
   direction and closes the loop with #1.

Both show a loading state (Insights is async, ~1–5s), an empty state ("no login
events in the last 90 days"), and a one-line note on the 90-day / login-only
scope. A "copy IP" affordance on each IP (sets up the future WAF-block).

## Scope

**In (v1):**
- `runInsights` helper + the two queries.
- IAM grant (Terraform) for Insights read on the run.auth log group.
- Two admin API routes (user→IPs, IP→users).
- Drawer "login IPs" section + top-level IP-lookup panel, cross-linked.
- IP-shape validation on the lookup input.

**Out (follow-on phases):**
- **WAF-block action.** A "block at the edge" button that adds an IP to the
  CloudFront WAFv2 IPSet. Needs `wafv2:GetIPSet`/`UpdateIPSet` + the IPSet ARN +
  a confirm UX, and connects to the existing WAF/abuse infra (phases 40/41 /
  waffaw). Its own spec.
- **Cross-account "shared IP" auto-report** (IPs used by >1 account, ranked). The
  bidirectional lookup already answers this on demand; a standing report /
  badge ("this IP also on N accounts") is a nice follow-on but not required for
  the core ask.
- **Per-request IP history** (beyond login moments) — would need ALB/CloudFront
  access logs joined to identity, which they can't be (no auth context). Login
  events are the right and only identity-joinable source.

## Tradeoffs / Risks

- **Insights cost/latency:** queries scan the log group and bill per GB. Both
  queries `filter` on `userId`/`ip` before `stats`, and the group is small
  (~130KB today), so cost is negligible now; if the log grows, keep the 90-day
  cap and consider caching the IP-lookup direction. Latency is async (~1–5s) —
  the UI must not block.
- **Login-only granularity** — stated in the UI; correct for the sharing signal.
- **IP spoofing of `x-forwarded-for`:** behind CloudFront the first XFF hop is
  set by the edge, so it's trustworthy for our origin; not a concern here.
- **PII:** IPs + emails are surfaced, but this panel is already admin-gated
  (non-disclosure 404) and seen by ~2 trusted admins — consistent with the
  emailFull relaxation already shipped.

## Key files

- `src/lib/log-event.ts` — the event shape (source of truth for field names)
- `src/config/auth.ts:285,291` — where `auth.login`/`auth.signup` are emitted
- `src/lib/insights.ts` — NEW `runInsights` helper
- `src/app/api/admin/identities/[userId]/ips/route.ts` — NEW (user → IPs)
- `src/app/api/admin/ip-lookup/route.ts` — NEW (IP → users)
- `src/app/admin/AdminConsole.tsx` — drawer "login IPs" section + IP-lookup panel
- `infra/terraform/live/site/services/run.auth/…` — IAM grant for Insights read
