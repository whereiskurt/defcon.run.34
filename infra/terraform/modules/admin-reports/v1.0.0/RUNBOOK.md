# admin-reports — Operator Runbook

This runbook captures the **account-side controls that have no Terraform lever** and the
operational knowledge the code cannot encode. It lives alongside the `admin-reports/v1.0.0`
module because it is the human counterpart to the metrics, dashboard, saved queries, and
tripwire alarms that module deploys.

Read this together with:

- `infra/terraform/modules/admin-reports/v1.0.0/` — the module (metric filters, retention,
  the seven `admin/*` saved queries, and the dashboard/alarms built on the
  `DefconRun/Activity` metric namespace).
- `infra/terraform/live/site/site.hcl` → the `admin_reports` block — the one place the
  operator turns the volume knobs (retention, alert email, alarm thresholds).

Two sections:

1. **Mapbox account hardening** — the AR-08b checklist. Mapbox exposes **no usage API**, so
   the mitigation is account configuration plus our own real-time leading indicator.
2. **Reading the reports** — how to use the dashboard, the `admin/*` saved queries, and the
   `site.hcl` thresholds day-to-day.

---

## 1. Mapbox account hardening (AR-08b)

**Why this is a runbook and not code.** Mapbox statistics are **dashboard-only**: there is no
usage API to poll, the numbers lag roughly **24 hours**, and they are only filterable per token
after the fact. Worse, the public Mapbox token ships to the browser and is therefore
**scrapeable from client JS** — anyone who loads a map can lift the token and spend our quota
from their own pages. Terraform cannot fix any of that; the levers live in the Mapbox account
console. Perform these four steps in the Mapbox account (https://account.mapbox.com), in order.

### 1.1 URL-restrict the public token to `*.defcon.run` origins — **THE CRITICAL CONTROL**

This is the single most important step. Because the token is scrapeable from client JS,
restricting **where** it may be used is the only thing that stops a scraped token from being
spent off our domains.

- Go to **Account → Tokens** (https://account.mapbox.com/access-tokens/).
- Open the **public** token that the gpx app serves (the value behind
  `MAPBOX_DEFAULT_TOKEN`; see 1.5).
- Under **URL restrictions**, add the defcon.run origins the maps render on — at minimum
  `https://gpx.defcon.run` and `https://run.defcon.run`, plus any other `*.defcon.run`
  subdomain that embeds a map. Use the exact HTTPS origins Mapbox expects (scheme + host, no
  path).
- Save. Once restricted, a scraped token used from any other origin is rejected by Mapbox at
  the tile request — the quota can no longer be spent from a third-party page.

> If you do only one thing on this list, do this one.

### 1.2 Issue a dedicated per-app token (gpx at minimum)

A single shared token makes the Mapbox dashboard's **per-token usage filter** useless — every
render, from every app, collapses into one line. Issue a dedicated token per app so usage is
attributable.

- In **Account → Tokens**, create a new public token named for its app (e.g. `gpx-public`).
- Apply the same URL restriction from 1.1 (scope it to that app's origin — `gpx-public` →
  `https://gpx.defcon.run`).
- Wire the gpx app to serve this dedicated token (see the optional code lever in 1.5). At
  minimum, gpx should have its own token so its map traffic is isolated on the Mapbox
  dashboard's per-token view.
- Result: the Mapbox dashboard's per-token filter now attributes tile usage to a specific app,
  so a spike is traceable to gpx vs. anything else.

### 1.3 Set a spending cap on the Mapbox account

The hard backstop. Even with URL restriction and per-app tokens, set an account-level spending
cap so a runaway or abuse spike cannot produce an unbounded bill.

- Go to **Account → Billing** (https://account.mapbox.com/settings/billing/) and set a
  **spending limit / cap** at a level comfortably above expected con-week map volume but below
  a number that would hurt.
- Configure the billing email so the cap warning reaches the operator before the ceiling, not
  after.
- This is the "sleep at night" control: it bounds the blast radius if 1.1/1.2 are somehow
  circumvented or misconfigured.

### 1.4 `gpx.map.view` is the real-time leading indicator (not the Mapbox dashboard)

Because Mapbox's own stats lag ~24h and expose no API, **do not rely on the Mapbox dashboard to
catch a live spike.** We emit our own event instead.

- The gpx app fires a `gpx.map.view` structured event from the server every time a client
  fetches its Mapbox token immediately before rendering a map (the
  `/api/user/mapbox-token` GET route). Our logs are **live**; the Mapbox dashboard is a day
  behind.
- The `admin-reports` module turns that event into the **`MapViews`** metric in the
  `DefconRun/Activity` namespace (via a CloudWatch metric filter on the gpx `/ecs/*` log
  group). It shows up on the dashboard's event widget in near real time.
- **Operational rule:** watch `MapViews` (and the top-IPs query, section 2) as the live signal.
  Treat the Mapbox dashboard as the ~24h-lagged **confirmation / billing reconciliation** view,
  not the alerting surface. If `MapViews` spikes, act on it now; don't wait for Mapbox's
  numbers to catch up a day later.

### 1.5 Optional code lever — split the gpx token into a dedicated per-app env var

Today gpx resolves its public token from a single shared env var:

- **File:** `apps/run.gpx/webapp/src/lib/mapbox-token.ts` — `resolveMapboxToken()` falls back to
  `process.env.MAPBOX_DEFAULT_TOKEN`.
- **Route that serves it:** `apps/run.gpx/webapp/src/app/api/user/mapbox-token/route.ts`.

To fully realize the per-app-token control (1.2) in code, a follow-up can introduce a dedicated
variable (e.g. `MAPBOX_GPX_TOKEN`) that gpx prefers over the shared `MAPBOX_DEFAULT_TOKEN`, and
set it in the gpx task's environment. This is **optional** — the account-side steps above
deliver the security benefit regardless. Recorded here so a follow-up can pick it up without
re-deriving where the token lives.

---

## 2. Reading the reports

Everything below runs in the **CloudWatch console in `us-east-1`** (the only live region;
CloudFront metrics and the app `/ecs/*` log groups both live there).

### 2.1 Open the dashboard

- CloudWatch → **Dashboards** → **`admin-reports`**.
- The dashboard combines free infra metrics (ALB `RequestCount` / 4XX / 5XX / latency per
  target group; CloudFront `Requests` and error rates per domain) with our custom
  `DefconRun/Activity` event metrics (`Signups`, `Logins`, `GpxUploads`, `GpxShares`,
  `MapViews`, `Checkins`, `Uploads`, `StravaRateLimitUsage`) and two Logs Insights widgets.

### 2.2 The two numbers to watch

- **Distinct active users, last hour** (the headline widget): a `count_distinct(userId)` over
  the three app log groups — the "how many humans are actually doing something right now"
  number. This is the single most-asked metric; it's the first thing to glance at.
- **Top IPs by event count**: the busiest client IPs in the recent window. Pre-con, an IP with
  a lot of events and no matching signups is the classic recon/abuse tell — pivot straight into
  `admin/ip-activity` (2.3) to see exactly what it did.

### 2.3 Run a saved `admin/*` query (the "dig in" workflow)

CloudWatch → **Logs** → **Logs Insights** → **Queries** (right panel) → open the **`admin/`**
folder. The module ships seven saved queries:

| Query | Answers |
|---|---|
| `admin/user-activity` | Everything one user did (by `userId` **or** `email`) |
| `admin/ip-activity` | Everything one IP did |
| `admin/top-ips-1h` | Busiest IPs in the last hour |
| `admin/top-uploaders` | Who is uploading the most (gpx creates + human uploads) |
| `admin/signups-over-time` | Signups bucketed per hour |
| `admin/distinct-users-by-day` | Distinct active users per day (the trend behind 2.2) |
| `admin/error-spikes` | Non-event `error` log volume per service (logging/health breakage) |

**Edit-the-placeholder workflow** (for `admin/user-activity` and `admin/ip-activity`): the two
"dig in" queries ship with a literal placeholder you swap before running.

1. Open the query — it loads into the editor with `PUT-USER-ID-HERE` / `PUT-EMAIL-HERE`
   (user-activity) or `PUT-IP-HERE` (ip-activity) in the `filter` line.
2. Replace the placeholder with the real value (the userId/email from the dashboard, or the IP
   from the top-IPs widget). Leave the surrounding query untouched.
3. Set the time range (top-right) and **Run query**. Results come back newest-first, up to 200
   rows.

The other five queries take no placeholder — open and run.

### 2.4 Bump thresholds from pre-con to con-week

**Pre-con posture (this is deliberate):** the user baseline is ~zero, so *any* activity is
presumptively recon/abuse. The alarm thresholds are intentionally low — **`Signups >= 1` per
hour firing is expected signal, not noise.** Do not "fix" the noise pre-con; that noise is the
point. When real attendees arrive for con-week, raise the volume knob.

All thresholds live in **one place**: the `admin_reports` block in
`infra/terraform/live/site/site.hcl`. To bump them:

1. Edit the `admin_reports.thresholds` map in `site.hcl` — a one-line change per threshold:
   - `signups_per_hour` (pre-con `1`)
   - `gpx_uploads_per_hour` (pre-con `5`)
   - `alb_5xx_per_5min` (pre-con `10`)
   Raise each to its con-week value. (The SNS `alert_email`, `log_retention_days`, and the
   `/ecs/*` `log_group_names` map also live in this same block.)
2. Apply the change to **only** the admin-reports unit:
   ```
   cd infra/terraform/live/site/region/us-east-1/admin-reports
   terragrunt apply
   ```
   This is a self-contained unit — applying it does not touch other stacks. The alarms
   re-evaluate against the new thresholds immediately.

That's the whole con-week transition: edit three numbers in `site.hcl`, `terragrunt apply` the
`us-east-1/admin-reports` unit, done.

---
