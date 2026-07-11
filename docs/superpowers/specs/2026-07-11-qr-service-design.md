# q.defcon.run — QR / short-link / CTF front-door service

**Status:** Design — approved for planning
**Date:** 2026-07-11
**Author:** KPH (with Claude)
**Scope:** One spec, phased implementation (Phases 1–5)

---

## 1. Overview

A lightweight URL service on new short hostnames that does three things:

1. **Static edge redirects** (`r.defcon.run`, `h.defcon.run`, …) — vanity redirects handled entirely by ALB listener rules, no compute.
2. **Dynamic codes** (`q.defcon.run/{CODE}/{PARAM}`) — a QR code resolves through a Lambda-behind-ALB that applies param-driven / time-windowed / passthrough routing, then 302-redirects.
3. **CTF front-door** (`q.defcon.run/ctf/{challenge}/{value}`) — the same resolver recognizes the reserved `ctf` namespace and 302-hands-off the submission to `run.human`, which is the authenticated **judge**: it validates the answer and performs any user-record writes.

The resolver runs in **us-east-1 only** over a **global** DynamoDB table. It is region-*aware* rather than region-*replicated*: when a destination points at run.human, the resolver reads the user's region cookie and builds a region-scoped path (`run.defcon.run/cac1/…` if the cookie says `cac1`, else `run.defcon.run/use1/…`). This matches the existing `/use1//cac1/` route convention.

Scan analytics are collected off the hot path via structured log lines and rolled up to DynamoDB on a schedule (default 30 min) or on demand via a header-protected flush. No per-scan DynamoDB writes.

### Design instinct being honored
"Leverage ALB rules instead of landing traffic in ECS." Static redirects never touch compute; dynamic codes hit a thin stateless Lambda, not the ECS apps. Nothing writes to DynamoDB on every scan.

---

## 2. Goals / Non-goals

**Goals**
- Printable, memorable short URLs that resolve fast and can be re-pointed without reprinting the QR.
- Redirect logic: fixed redirect, param-driven destination, time/state windows, query/UTM enrichment.
- Basic per-code scan analytics aggregated to DynamoDB (not real-time, not per-scan writes).
- Live management via the run.human admin dashboard (the current branch).
- Reuse the same front-door + management + analytics layers for CTF flag capture, with validation and user mutation kept in the authenticated app.

**Non-goals (YAGNI)**
- QR *image* generation (out of scope; codes are just URLs).
- ~~CloudFront in front of `q./r./h.` — DNS points straight at the ALB.~~ **CORRECTED (2026-07-11):** the public ALB's security group accepts 443 **only** from the CloudFront origin-facing prefix list, so DNS pointing straight at the ALB is unreachable (connect times out). Any public hostname MUST front through CloudFront. Phase 1 `r./h.` therefore ship as **CloudFront edge-function redirects** (a viewer-request CloudFront Function returns the 301/302; no ALB, no origin contacted). **Phase 2 implication:** the `q.` resolver cannot be reached direct-to-ALB either — it must be **CloudFront → ALB → Lambda** (Host header forwarded, caching disabled), or the resolver moves to a **CloudFront Function / Lambda@Edge**. See memory `reference_alb_cloudfront_only`.
- Per-scan atomic DynamoDB counters.
- Truly secret flags delivered over a GET URL (see §9 Security — flag values in a scanned URL are semi-public by nature).

---

## 3. Architecture

```
                          ┌─────────────────────────────────────────┐
  QR scan / click ───────▶│  ALB (us-east-1)                        │
                          │                                          │
   r.defcon.run  ─────────┼─▶ listener rule: redirect → youtube (302)│  (no compute)
   h.defcon.run  ─────────┼─▶ listener rule: redirect → run.* (301)  │  (no compute)
                          │                                          │
   q.defcon.run/*  ───────┼─▶ listener rule → Lambda target group    │
                          └───────────────┬──────────────────────────┘
                                          ▼
                                 resolver Lambda (stateless, use1)
                                          │  reads region cookie → {use1|cac1}
                        ┌── DynamoDB GetItem: qr code (GLOBAL table) ──┐
                        │   warm in-memory cache ~60s for hot codes    │
                        └───────────────────┬──────────────────────────┘
                          redirect codes ───┤        ctf namespace ───┐
                                            ▼                         ▼
                     302 → dest (run.* dests get /{region}/)  302 → run.defcon.run/{region}/ctf/claim?...
                                            │                         │
                                            └──────── emit 1 structured JSON log line ────────┐
                                                (ctf: logs handoff only, NEVER the value)     │
                                                                                              ▼
                                                                                   CloudWatch Logs group
                                                                                              │
                              EventBridge cron (30m)  /  q.defcon.run/_flush (header-guarded) │
                                                                                              ▼
                                                          rollup Lambda → Logs Insights → DynamoDB (qrstat)

   run.human (ECS, authenticated) ── /ctf/claim ──▶ read ctf entity, validate value,
                                                    rate-limit + idempotent claim,
                                                    write user record / effects, render result
```

**Component boundaries**
- **Resolver Lambda** — one job: parse path, look up code, apply rules, 302, log. No writes to user data. No CTF validation.
- **Rollup Lambda** — one job: on schedule/flush, aggregate log lines into `qrstat`. Owns the analytics watermark.
- **run.human `/ctf/claim`** — the only place CTF answers are checked and user records mutated. Has session/auth.
- **Admin dashboard (run.human)** — CRUD for `qr` and `ctf` entities; reads `qrstat` for scan counts.
- **Terraform** — static redirect rules, the ALB→Lambda listener rule, the resolver + rollup Lambdas, DNS, IAM, DynamoDB global-table replication.

---

## 4. URL grammar

Path is parsed into segments after the host:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `/{code}` | code, no param | `q.defcon.run/BUNNY` |
| `/{code}/{param}` | code + param | `q.defcon.run/BUNNY/42` |
| `/ctf/{challenge}/{value}` | reserved `ctf` namespace → handoff | `q.defcon.run/ctf/flag1/abc123` |
| `/_flush` | reserved; header-guarded analytics flush | `q.defcon.run/_flush` |

Rules:
- `ctf` and `_flush` are **reserved** first segments (a redirect code may not be named these).
- Trailing `?query` is preserved for enrichment on redirect codes.
- Codes are case-insensitive on lookup (stored normalized); values/params are passed through verbatim.

---

## 5. Data model (ElectroDB entities in the shared table)

The service adds three entities to the existing single-table design (`ELECTRO_TABLE`, pk/sk + gsi1). The table must be a **global table** replicated to both regions (see §8).

### 5.1 `qr` — redirect code (written by admin, read by resolver)
```
code        (pk, normalized)        e.g. "BUNNY"
type                                "redirect" (default)
destination                         default absolute https URL
rules[]      ordered, first-match:
   { kind: "time",  from, to, dest }        // ISO timestamps; active when now ∈ [from,to]
   { kind: "param", match: "42" | "*", dest }
enrich      { preserveQuery: bool, appendParam: bool, utm: {source,medium,campaign} }
enabled     bool
owner, notes, createdAt, updatedAt
```
**Resolution order:** time rules → param rules → `destination`. First match wins. Always **302** (destinations change; never let browsers cache a permanent redirect).

### 5.2 `ctf` — challenge (written by admin, read ONLY by run.human judge)
```
challenge   (pk)                    e.g. "flag1"
answer                              correct value (see §9 on hashing)
points
effect      { awardPoints?, unlock?, affectUser?: { userId|selector, mutation } }
maxAttempts, rateLimitWindow
enabled, createdAt, updatedAt
```
The resolver Lambda never reads this entity — it only constructs the handoff URL.

### 5.3 `qrstat` — analytics aggregates (written by rollup, read by dashboard)
```
pk: code (or "ctf#{challenge}")
sk: bucket   → "total" | "day#2026-08-06" | "param#42"
count, lastSeen
```
Plus a meta row `pk="_meta", sk="watermark"` holding the last-processed log timestamp so rollups only scan new lines.

---

## 6. Resolver logic

**Redirect code**
1. Parse path → `{code, param}`.
2. GetItem `qr` by code (check warm cache first). Missing or `enabled=false` → 404 fixed response (or configurable redirect to `run.defcon.run`).
3. Evaluate `rules` in order (time, then param); fall back to `destination`.
4. Apply `enrich`: preserve original query, append param, add UTM tags.
5. **Region rewrite:** if the resolved destination targets run.human (`run.defcon.run`), read the region cookie and inject the region path segment — `run.defcon.run/cac1/…` when the cookie says `cac1`, else `run.defcon.run/use1/…`. Non-run.human destinations are left untouched.
6. Return `302` with `Location`. Emit structured log line: `{type:"redirect", code, param, matchedRule, destHost, region, ua, geo}`.

**CTF namespace**
1. Path `ctf/{challenge}/{value}`.
2. Resolve region from cookie (default `use1`).
3. Return `302` → `https://run.defcon.run/{region}/ctf/claim?c={challenge}&v={urlencoded value}`.
4. Emit log line: `{type:"ctf-handoff", challenge, region, result:"handoff"}` — **never** log `value`.

**Judge (run.human `/ctf/claim`, authenticated)**
1. Require a logged-in session (anon → prompt to log in, preserving the claim).
2. Read `ctf` entity for `challenge`; enforce `maxAttempts` / rate-limit per user.
3. Compare `v` to `answer`. On correct: idempotent claim (per user+challenge — a re-claim is a no-op), apply `effect` (award points, unlock, affect another user's record), render success. On wrong: increment attempt, render failure.

---

## 7. Analytics (log-line + scheduled rollup)

- Resolver writes **no** analytics to DynamoDB on the hot path — one CloudWatch Logs line per scan.
- **Rollup Lambda** on an EventBridge cron (default `rate(30 minutes)`): runs a Logs Insights query over the resolver log group since `_meta/watermark`, upserts counts into `qrstat` (`total`, `day#…`, `param#…`, `ctf#{challenge}`), advances the watermark.
- **On-demand flush:** `GET q.defcon.run/_flush` with header `X-QR-Flush-Token` (secret in SSM) → resolver validates the token and synchronously invokes the rollup. No token / bad token → 404.
- *Alternative considered:* Athena over exported logs (matches the Phase 41 abuse-detection pattern). Not chosen for launch — Logs Insights needs no S3/Firehose/Glue plumbing. Revisit if query volume/retention outgrows Insights.

---

## 8. Infrastructure (use1 resolver, global data, region-aware redirects)

The resolver is **single-region (us-east-1)** but region-*aware*: it emits region-scoped run.human URLs based on the cookie. This avoids duplicating the resolver/listener-rule stack in cac1 while still sending users to their region's run.human namespace. The data layer is global so a future cac1 resolver (or run.human in either region) reads the same codes.

In `us-east-1`:
- ALB listener rule: host `q.defcon.run` → **Lambda target group** → resolver Lambda.
- ALB listener rules: host `r.defcon.run` / `h.defcon.run` → **`redirect` action** (new capability — the current `ecs-service` module only emits `forward`; add a small `redirect-rule` resource/module that emits `type = "redirect"`).
- Resolver Lambda + rollup Lambda (Node), EventBridge cron for rollup.
- Route53 records for `q./r./h.defcon.run` → the use1 ALB.

Region resolution:
- Resolver reads the run.human **region cookie** (confirm exact name — see Open Questions) to choose `use1` (default) or `cac1` when rewriting run.human destinations and the CTF handoff URL.

Shared / global:
- **DynamoDB global table** (replicated use1 + cac1) holding `qr`/`ctf`/`qrstat` (verify whether the existing `ELECTRO_TABLE` is already global or a new global table is required — see Open Questions).
- **Cert:** none needed — `*.defcon.run` wildcard SAN already covers `q./r./h.` (`certs/v1.0.0/acm.tf:20`).
- **IAM:** resolver role → `dynamodb:GetItem` on the table + `logs:PutLogEvents`; rollup role → `logs:StartQuery/GetQueryResults` + `dynamodb` write on `qrstat`; run.human task role → read `ctf`, write user records (extend existing policy).

---

## 9. Security considerations

- **Flag values in URLs are logged and semi-public.** ALB access logs capture the full request path regardless of Lambda behavior, so `/ctf/flag1/abc123` lands in ALB S3 logs. Mitigations: (a) resolver's *structured analytics* line never contains the value; (b) treat flag values as **spent-on-use** — CTF claims are single-use per user, rate-limited, and grant points not secrets, so a value leaked to logs has low residual value; (c) if a challenge needs true secrecy, a scanned GET URL is the wrong channel — use an in-app flow instead. Document this per challenge.
- **Identity & privileged writes stay in run.human.** "Affect another user" is a normal, reviewable, session-bound operation in the app — never in the anonymous edge Lambda.
- **Anti-cheat** (in the judge): per-user + per-IP rate limiting, `maxAttempts`, replay/idempotency so a shared correct URL can't be farmed.
- **Answer storage:** prefer storing a hash of `answer` and comparing hashes in the judge, so a DB/admin-UI leak doesn't reveal plaintext flags. (Exact-match challenges only; fuzzy answers need plaintext.)
- **Open-redirect:** destinations are admin-set; validate they are absolute `https://` URLs on write. The CTF handoff target is a fixed constant (`run.defcon.run`).
- **Redirect status:** `302` for all dynamic codes and the rickroll (flexibility); `h.` may be `301`.

---

## 10. Testing

- **Unit:** path parser (all grammars incl. reserved namespaces); rule resolver (time window active/inactive, param exact vs `*`, fallback); enrichment (query preserve, UTM append); redirect builder.
- **Log-hygiene test:** assert the resolver's ctf log line never contains the submitted value.
- **Integration:** Lambda handler with mocked DynamoDB → assert `Location` and status for redirect + ctf-handoff.
- **Judge:** validate correct/incorrect, idempotent re-claim, rate-limit, effect application (including affect-another-user).
- **E2E:** deploy to a test host; `curl` scans assert 302 + `Location`; trigger `/_flush` and assert `qrstat` counts; verify DNS resolves per region.

---

## 11. Phasing

| Phase | Deliverable | Independently shippable |
|-------|-------------|-------------------------|
| **1. Static redirects** | `r./h.` CloudFront edge-function redirects + apex DNS + `cloudfront-redirect` module (superseded the initial ALB-listener-rule approach — the ALB is CloudFront-only) | ✅ value day one |
| **2. Resolver MVP** | ALB→Lambda target, resolver Lambda, `qr` entity, `q.` DNS — simple redirect only | ✅ |
| **3. Rule engine** | param rules, time windows, enrichment; warm-cache | ✅ |
| **4. Analytics + admin UI** | log line → rollup Lambda → `qrstat`, `/_flush`; admin dashboard CRUD + scan counts | ✅ |
| **5. CTF front-door** | `ctf` namespace handoff in resolver + run.human `/ctf/claim` judge + `ctf` entity + admin CRUD + anti-cheat | ✅ |

The resolver deploys to **use1 only**; the DynamoDB table is **global** from Phase 2. Region-aware destination rewriting (cookie → `/use1//cac1/`) lands in Phase 3 with the rule engine.

---

## 12. Open questions

1. **Global table:** Is the existing `ELECTRO_TABLE` already a DynamoDB global table replicated to cac1, or must we stand up a new global table / add replicas? (Verify before Phase 2.)
2. **Unknown-code behavior:** 404 page vs. redirect to `run.defcon.run` — confirm the default.
3. **Anonymous CTF claim:** require login before `/ctf/claim`, or allow the claim to be held and applied after a login prompt?
4. **Region cookie:** confirm the exact cookie name/values run.human sets for `use1`/`cac1`, and the behavior when it's absent (default `use1`) or holds an unknown value.
5. **Region path convention:** confirm run.human serves `run.defcon.run/use1/…` and `/cac1/…` for the destinations we'll target (including `/ctf/claim`), consistent with the status-site root-302 behavior.
