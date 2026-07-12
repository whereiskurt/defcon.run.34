# IP Visibility (bidirectional IP ↔ user lookup) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an admin answer "what IPs did user X log in from?" and "what users logged in from IP Y?" directly in the identity console, backed by CloudWatch Logs Insights over existing login events.

**Architecture:** A server-only `src/lib/insights.ts` runs a bounded Logs Insights query (StartQuery → poll GetQueryResults → map rows) against the run.auth app log group, using the default AWS credential chain (the ECS task role already has `logs:*`). Two session-gated admin routes expose the two directions; the AdminConsole drawer gets a lazily-fetched "login IPs" section and a top-level IP-lookup panel, cross-linked.

**Tech Stack:** Next.js App Router routes (`runtime=nodejs`), `@aws-sdk/client-cloudwatch-logs` (NEW dep), CloudWatch Logs Insights, React client console, vitest.

## Global Constraints

- **NO Terraform / IAM change.** The shared `app`-cluster ECS task role already grants `logs:*` on `*` (confirmed: `modules/ecs-cluster/v1.0.0/main.tf:98-128` + `CloudWatchFullAccessV2`). Do NOT edit the shared module. The CloudWatch client uses the **default credential provider chain** (NO explicit `credentials` block) so it transparently picks up the task-role container creds. This corrects the spec's IAM section.
- **Node ≥ 22.12 for vitest:** `nvm use 23.6.0` before `npm test`.
- **Add `@aws-sdk/client-cloudwatch-logs` pinned to `^3.893.0`** (match the existing `@aws-sdk/*` versions in `apps/run.auth/webapp/package.json`).
- **Log-event field contract (LOCKED):** flat JSON `{ evt, userId, email, ip, ua, meta }`; `evt` ∈ `"auth.login"`/`"auth.signup"`; `ip`, `userId` are top-level, camelCase. Queries filter `evt` to those two so `ip` is always present.
- **Log group name:** `/ecs/run-auth-app-run-auth-${REGION_SHORT}-dc34` (REGION_SHORT ∈ use1/cac1/apse1, default use1). The admin console is per-region; each region's console queries its own region's group. Multi-region aggregation is an explicit follow-up.
- **Region for the SDK client:** `process.env.AWS_REGION` (full name, e.g. `us-east-1`) — same var the DynamoDB client uses.
- **Admin routes:** `await auth()` + `requireAdmin` + in-process `revalidateAdmin`; deny → **404** (non-disclosure, never 401/403); `runtime="nodejs"`, `dynamic="force-dynamic"`; responses `Cache-Control: no-store`.
- **Query-injection defense-in-depth:** validate/sanitize any value interpolated into a query string (IP shape check; userId id-charset check) → 400 on failure, even though the routes are admin-gated.
- **UI region prefix:** every console fetch MUST use the `BASE` prefix (`/use1` in prod) or it 404s.
- **Commits** end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/run.auth/webapp/package.json` | +`@aws-sdk/client-cloudwatch-logs` | 1 |
| `src/lib/insights.ts` (NEW) | CloudWatch client + `runInsights` + query builders + IP/userId validation + log-group name | 1 |
| `src/lib/insights.test.ts` (NEW) | unit tests (validation, query builders, mapResults, poll/timeout with injected fake client) | 1 |
| `src/app/api/admin/identities/[userId]/ips/route.ts` (NEW) | user → IPs | 2 |
| `src/app/api/admin/ip-lookup/route.ts` (NEW) | IP → users | 2 |
| `src/app/admin/AdminConsole.tsx` | drawer "login IPs" section + top-level IP-lookup panel, cross-linked | 3 |
| `apps/run.auth/webapp/package.json` (version) + spec note | version bump + correct spec IAM note | 4 |

---

## Task 1: Insights query layer (`src/lib/insights.ts`) + dep

**Files:**
- Modify: `apps/run.auth/webapp/package.json` (add dep)
- Create: `src/lib/insights.ts`
- Test: `src/lib/insights.test.ts`

**Interfaces (Produces — Tasks 2 consumes these):**
- `runInsights(queryString, startMs, endMs, opts?): Promise<{ rows: Record<string,string>[]; partial: boolean }>` — `opts.client` injectable for tests; `opts.timeoutMs` (default 10000), `opts.pollMs` (default 400).
- `ipsOfUserQuery(userId): string`, `usersOfIpQuery(ip): string`
- `isValidIp(s): boolean`, `isSafeUserId(s): boolean`
- `logGroupName(): string`, `DEFAULT_WINDOW_MS: number`

- [ ] **Step 1: Add the dependency.** In `apps/run.auth/webapp/package.json`, add to `dependencies` (alphabetically near the other `@aws-sdk/*`):

```json
    "@aws-sdk/client-cloudwatch-logs": "^3.893.0",
```

Then run (Node 23): `npm install` — expect it to resolve `@aws-sdk/client-cloudwatch-logs@3.893.x`.

- [ ] **Step 2: Write the failing test.** Create `src/lib/insights.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  isValidIp,
  isSafeUserId,
  ipsOfUserQuery,
  usersOfIpQuery,
  logGroupName,
  runInsights,
  __mapResultsForTest,
} from "./insights";

describe("isValidIp", () => {
  it("accepts IPv4 and IPv6, rejects junk / injection", () => {
    expect(isValidIp("65.25.248.28")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp('1.1.1.1" or evt="x')).toBe(false);
    expect(isValidIp("")).toBe(false);
    expect(isValidIp("not-an-ip")).toBe(false);
  });
});

describe("isSafeUserId", () => {
  it("accepts id charset, rejects quotes/spaces/injection", () => {
    expect(isSafeUserId("1bd4a2f0-1234-4abc-9def-000000000000")).toBe(true);
    expect(isSafeUserId('x" or userId="y')).toBe(false);
    expect(isSafeUserId("has space")).toBe(false);
    expect(isSafeUserId("")).toBe(false);
  });
});

describe("query builders", () => {
  it("embeds the (validated) value and filters login+signup before stats", () => {
    const q = ipsOfUserQuery("USER1");
    expect(q).toContain('userId="USER1"');
    expect(q).toContain('evt="auth.login"');
    expect(q).toContain('evt="auth.signup"');
    expect(q.indexOf("filter")).toBeLessThan(q.indexOf("stats")); // filter before stats
    expect(usersOfIpQuery("1.2.3.4")).toContain('ip="1.2.3.4"');
  });
});

describe("logGroupName", () => {
  it("derives from REGION_SHORT, honors AUTH_LOG_GROUP override", () => {
    vi.stubEnv("AUTH_LOG_GROUP", "");
    vi.stubEnv("REGION_SHORT", "cac1");
    expect(logGroupName()).toBe("/ecs/run-auth-app-run-auth-cac1-dc34");
    vi.stubEnv("AUTH_LOG_GROUP", "/custom/group");
    expect(logGroupName()).toBe("/custom/group");
    vi.unstubAllEnvs();
  });
});

describe("__mapResultsForTest", () => {
  it("maps [{field,value}] rows to objects and drops @ptr", () => {
    const rows = __mapResultsForTest([
      [{ field: "ip", value: "1.2.3.4" }, { field: "logins", value: "3" }, { field: "@ptr", value: "xxx" }],
    ]);
    expect(rows).toEqual([{ ip: "1.2.3.4", logins: "3" }]);
  });
});

describe("runInsights", () => {
  function fakeClient(script: any[]) {
    const send = vi.fn();
    for (const r of script) send.mockResolvedValueOnce(r);
    return { send };
  }

  it("polls until Complete and returns mapped rows", async () => {
    const client = fakeClient([
      { queryId: "q1" }, // StartQuery
      { status: "Running", results: [] }, // GetQueryResults #1
      { status: "Complete", results: [[{ field: "ip", value: "1.2.3.4" }, { field: "logins", value: "2" }]] },
    ]);
    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1 });
    expect(out.partial).toBe(false);
    expect(out.rows).toEqual([{ ip: "1.2.3.4", logins: "2" }]);
    expect(client.send).toHaveBeenCalledTimes(3);
  });

  it("returns partial=true and stops the query on timeout", async () => {
    const client = fakeClient([
      { queryId: "q1" },
      { status: "Running", results: [] },
      { status: "Running", results: [] },
      {}, // StopQuery response
    ]);
    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1, timeoutMs: 5 });
    expect(out.partial).toBe(true);
    expect(out.rows).toEqual([]);
  });

  it("returns empty when StartQuery yields no queryId", async () => {
    const client = fakeClient([{}]);
    const out = await runInsights("q", 0, 1000, { client: client as any });
    expect(out.rows).toEqual([]);
    expect(out.partial).toBe(false);
  });
});
```

- [ ] **Step 3: Run to confirm it fails.**

Run: `nvm use 23.6.0 && npx vitest run src/lib/insights.test.ts`
Expected: FAIL — `Cannot find module './insights'`.

- [ ] **Step 4: Implement `src/lib/insights.ts`.**

```ts
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  StopQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";

/**
 * Server-only CloudWatch Logs Insights helper for the admin IP-visibility feature.
 * Queries the run.auth app log group over the existing auth.login/auth.signup events.
 * Uses the DEFAULT credential provider chain — the ECS task role already has logs:*.
 */

// No `credentials` block: default chain → ECS task-role container creds.
const defaultClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

type Sendable = { send: (cmd: unknown) => Promise<any> };

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_MS = 90 * DAY_MS;

export function logGroupName(): string {
  return (
    process.env.AUTH_LOG_GROUP ||
    `/ecs/run-auth-app-run-auth-${process.env.REGION_SHORT || "use1"}-dc34`
  );
}

// --- validation (values interpolated into the query string) ---

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function isValidIp(s: string): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > 45) return false;
  const m = s.match(IPV4);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  // IPv6: only hex + colon (+ optional embedded IPv4 dots), at least one colon
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s);
}

export function isSafeUserId(s: string): boolean {
  return typeof s === "string" && s.length > 0 && s.length <= 128 && /^[A-Za-z0-9._|-]+$/.test(s);
}

// --- query builders (callers MUST validate the arg first) ---

export function ipsOfUserQuery(userId: string): string {
  return [
    "fields @timestamp, ip, ua",
    `| filter (evt="auth.login" or evt="auth.signup") and userId="${userId}"`,
    "| stats count() as logins, earliest(@timestamp) as firstSeen, latest(@timestamp) as lastSeen, count_distinct(ua) as agents by ip",
    "| sort logins desc",
  ].join("\n");
}

export function usersOfIpQuery(ip: string): string {
  return [
    "fields @timestamp, userId, email",
    `| filter (evt="auth.login" or evt="auth.signup") and ip="${ip}"`,
    "| stats count() as logins, earliest(@timestamp) as firstSeen, latest(@timestamp) as lastSeen by userId, email",
    "| sort logins desc",
  ].join("\n");
}

// --- runner ---

export type InsightsRunResult = { rows: Record<string, string>[]; partial: boolean };

function mapResults(results: Array<Array<{ field?: string; value?: string }>> | undefined): Record<string, string>[] {
  if (!results) return [];
  return results.map((row) =>
    Object.fromEntries(
      row.filter((c) => c.field && c.field !== "@ptr").map((c) => [c.field as string, c.value ?? ""])
    )
  );
}

// exported under a test-only name so the pure mapper is covered without a live client
export const __mapResultsForTest = mapResults;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runInsights(
  queryString: string,
  startMs: number,
  endMs: number,
  opts: { client?: Sendable; timeoutMs?: number; pollMs?: number } = {}
): Promise<InsightsRunResult> {
  const client = opts.client ?? (defaultClient as unknown as Sendable);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const pollMs = opts.pollMs ?? 400;

  const start = await client.send(
    new StartQueryCommand({
      logGroupName: logGroupName(),
      startTime: Math.floor(startMs / 1000),
      endTime: Math.floor(endMs / 1000),
      queryString,
    })
  );
  const queryId: string | undefined = start?.queryId;
  if (!queryId) return { rows: [], partial: false };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.send(new GetQueryResultsCommand({ queryId }));
    const status: string | undefined = res?.status;
    if (status === "Complete") return { rows: mapResults(res.results), partial: false };
    if (status === "Failed" || status === "Cancelled" || status === "Timeout") {
      return { rows: mapResults(res.results), partial: true };
    }
    await sleep(pollMs);
  }
  try {
    await client.send(new StopQueryCommand({ queryId }));
  } catch {
    /* best-effort */
  }
  return { rows: [], partial: true };
}
```

- [ ] **Step 5: Run to confirm pass.**

Run: `npx vitest run src/lib/insights.test.ts`
Expected: PASS (all cases). Then full suite `npx vitest run` (51 + new) + `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit.**

```bash
git add apps/run.auth/webapp/package.json apps/run.auth/webapp/package-lock.json src/lib/insights.ts src/lib/insights.test.ts
git commit -m "feat(auth-admin): CloudWatch Logs Insights query layer for IP visibility"
```

---

## Task 2: Two admin API routes

**Files:**
- Create: `src/app/api/admin/identities/[userId]/ips/route.ts`
- Create: `src/app/api/admin/ip-lookup/route.ts`

**Interfaces:**
- Consumes: `runInsights`, `ipsOfUserQuery`, `usersOfIpQuery`, `isValidIp`, `isSafeUserId`, `DEFAULT_WINDOW_MS` from `@/lib/insights`; the gate from `@/config/auth` + `@/lib/admin-gate`.
- Produces: `GET /api/admin/identities/{userId}/ips` → `{ ips: [{ip,logins,firstSeen,lastSeen,agents}], partial }`; `GET /api/admin/ip-lookup?ip=` → `{ users: [{userId,email,logins,firstSeen,lastSeen}], partial }`.

- [ ] **Step 1: user → IPs route.** Create `src/app/api/admin/identities/[userId]/ips/route.ts`:

```ts
import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { runInsights, ipsOfUserQuery, isSafeUserId, DEFAULT_WINDOW_MS } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/** Login IPs for one identity over the last 90 days (CloudWatch Logs Insights). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;
  if (!isSafeUserId(userId)) return new Response(null, { status: 400 });

  const end = Date.now();
  const { rows, partial } = await runInsights(ipsOfUserQuery(userId), end - DEFAULT_WINDOW_MS, end);
  const ips = rows.map((r) => ({
    ip: r.ip ?? "",
    logins: Number(r.logins ?? 0),
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
    agents: Number(r.agents ?? 0),
  }));
  return Response.json({ ips, partial }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: IP → users route.** Create `src/app/api/admin/ip-lookup/route.ts`:

```ts
import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { runInsights, usersOfIpQuery, isValidIp, DEFAULT_WINDOW_MS } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/** Identities that logged in from a given IP over the last 90 days. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const ip = (new URL(req.url).searchParams.get("ip") ?? "").trim();
  if (!isValidIp(ip)) return new Response(null, { status: 400 });

  const end = Date.now();
  const { rows, partial } = await runInsights(usersOfIpQuery(ip), end - DEFAULT_WINDOW_MS, end);
  const users = rows.map((r) => ({
    userId: r.userId ?? "",
    email: r.email ?? null,
    logins: Number(r.logins ?? 0),
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
  }));
  return Response.json({ users, partial }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit` clean; full suite `npx vitest run` unchanged (route handlers not unit-tested here — the query layer is covered by Task 1; end-to-end needs a live log group).

- [ ] **Step 4: Commit.**

```bash
git add "src/app/api/admin/identities/[userId]/ips/route.ts" src/app/api/admin/ip-lookup/route.ts
git commit -m "feat(auth-admin): IP-visibility admin routes (user→IPs, IP→users)"
```

---

## Task 3: AdminConsole UI — drawer "login IPs" section + top-level IP-lookup panel

**Files:**
- Modify: `src/app/admin/AdminConsole.tsx`

**Interfaces:**
- Consumes: `GET ${BASE}/api/admin/identities/{userId}/ips` and `GET ${BASE}/api/admin/ip-lookup?ip=`.

READ `AdminConsole.tsx` fully first. Use the EXACT existing patterns (from the codebase map): `BASE` const (lines 12-16), `openDrawer` (178-183), the drawer JSX (351-435), the styling tokens below. Do not redefine tokens.

**Styling tokens (reuse verbatim):**
- Section header: `className="mb-2 text-[11px] uppercase tracking-wide text-default-400"`
- Row card: `className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]"`
- Mono value: `className="font-mono text-[11.5px] text-default-500"`
- Clickable accent: `className="cursor-pointer text-primary hover:underline"`
- Top-level panel: `<section className="mb-5 rounded-2xl border border-divider bg-content1 p-[18px]">`
- Input: `className="rounded-lg border border-divider bg-content1 px-3 py-2 text-[13px] outline-none focus:border-primary"`

- [ ] **Step 1: Add state for the lazily-fetched login-IP cache + the IP-lookup panel.** Near the existing drawer state (lines ~117-119), add:

```tsx
  type IpRow = { ip: string; logins: number; firstSeen: string | null; lastSeen: string | null; agents: number };
  type UserRow = { userId: string; email: string | null; logins: number; firstSeen: string | null; lastSeen: string | null };

  const [loginIps, setLoginIps] = useState<Record<string, IpRow[]>>({}); // keyed by userId, survives j/k
  const [ipsLoading, setIpsLoading] = useState(false);

  const [lookupIp, setLookupIp] = useState("");
  const [lookupUsers, setLookupUsers] = useState<UserRow[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupPartial, setLookupPartial] = useState(false);
```

- [ ] **Step 2: Lazily fetch login IPs when the drawer opens.** Add a `useEffect` keyed on the open identity (store in the `loginIps` cache so `j/k` stepping doesn't refetch/clear):

```tsx
  useEffect(() => {
    const uid = drawer?.identity.userId;
    if (!uid || loginIps[uid]) return; // cached
    let cancelled = false;
    setIpsLoading(true);
    fetch(`${BASE}/api/admin/identities/${encodeURIComponent(uid)}/ips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ips: [] }))
      .then((d) => { if (!cancelled) setLoginIps((m) => ({ ...m, [uid]: d.ips ?? [] })); })
      .catch(() => { if (!cancelled) setLoginIps((m) => ({ ...m, [uid]: [] })); })
      .finally(() => { if (!cancelled) setIpsLoading(false); });
    return () => { cancelled = true; };
  }, [drawer?.identity.userId, loginIps]);
```

- [ ] **Step 3: Add a `runIpLookup` handler** (used by both the top-level input and clicking an IP in the drawer):

```tsx
  async function runIpLookup(ip: string) {
    const v = ip.trim();
    setLookupIp(v);
    if (!v) { setLookupUsers(null); return; }
    setLookupLoading(true);
    setLookupPartial(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ip-lookup?ip=${encodeURIComponent(v)}`, { cache: "no-store" });
      if (!res.ok) { setLookupUsers([]); return; }
      const d = await res.json();
      setLookupUsers(d.users ?? []);
      setLookupPartial(Boolean(d.partial));
    } catch {
      setLookupUsers([]);
    } finally {
      setLookupLoading(false);
    }
  }
```

- [ ] **Step 4: Render the "login IPs" section in the drawer** (after the SSO-sessions block, ~line 423). Each IP is clickable → runs the reverse lookup:

```tsx
              <div>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-default-400">
                  login IPs <span className="text-default-300">· last 90 days</span>
                </h3>
                {ipsLoading && !loginIps[drawer.identity.userId] ? (
                  <p className="text-[12px] text-default-400">Loading…</p>
                ) : (loginIps[drawer.identity.userId]?.length ?? 0) === 0 ? (
                  <p className="text-[12px] text-default-400">No login events in the last 90 days.</p>
                ) : (
                  loginIps[drawer.identity.userId].map((r) => (
                    <div key={r.ip} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]">
                      <button type="button" onClick={() => runIpLookup(r.ip)} className="cursor-pointer font-mono text-[11.5px] text-primary hover:underline" title="who else used this IP?">
                        {r.ip}
                      </button>
                      <span className="text-default-500">{r.logins} logins · {r.agents} agents</span>
                    </div>
                  ))
                )}
              </div>
```

- [ ] **Step 5: Render the top-level IP-lookup panel** between the hero cards and the controls (after ~line 250). Each result user links to their drawer:

```tsx
          <section className="mb-5 rounded-2xl border border-divider bg-content1 p-[18px]">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-default-400">IP lookup <span className="text-default-300">· who logged in from an IP</span></h2>
            <div className="flex gap-2">
              <input
                value={lookupIp}
                onChange={(e) => setLookupIp(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runIpLookup(lookupIp); }}
                placeholder="paste an IP (IPv4 or IPv6)"
                className="flex-1 rounded-lg border border-divider bg-content1 px-3 py-2 text-[13px] outline-none focus:border-primary"
              />
              <button type="button" onClick={() => runIpLookup(lookupIp)} className="rounded-lg border border-divider px-3 py-2 text-[13px] hover:border-primary">Look up</button>
            </div>
            {lookupLoading ? (
              <p className="mt-2 text-[12px] text-default-400">Searching…</p>
            ) : lookupUsers === null ? null : lookupUsers.length === 0 ? (
              <p className="mt-2 text-[12px] text-default-400">No login events from this IP in the last 90 days.</p>
            ) : (
              <div className="mt-3">
                {lookupPartial && <p className="mb-1 text-[11px] text-warning">Partial results (query timed out).</p>}
                {lookupUsers.map((u) => (
                  <div key={u.userId} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]">
                    <button type="button" onClick={() => openDrawer(u.userId)} className="cursor-pointer text-primary hover:underline">
                      {u.email ?? u.userId}
                    </button>
                    <span className="text-default-500">{u.logins} logins</span>
                  </div>
                ))}
              </div>
            )}
          </section>
```

  > **Executor note:** Match the ACTUAL surrounding JSX — the exact line numbers will have shifted. Place the panel as a sibling `<section>` in the `<main>` stack between the hero cards `<section>` and the controls `<div>`; place the drawer section as a sibling `<div>` inside the drawer's `space-y-4` container. Ensure `useEffect`/`useState` are already imported (they are). Reuse the existing `openDrawer`, `BASE`, and `formatWhen`/recency helpers if present for `lastSeen` formatting; if you format `lastSeen`, use the same helper the table uses — otherwise show the raw value.

- [ ] **Step 6: Verify.** `npx tsc --noEmit` clean; `npm run build` succeeds; full suite `npx vitest run` unchanged.

- [ ] **Step 7: Commit.**

```bash
git add src/app/admin/AdminConsole.tsx
git commit -m "feat(auth-admin): login-IPs drawer section + IP-lookup panel, cross-linked"
```

---

## Task 4: Version bump + correct the spec's IAM note

**Files:**
- Modify: `apps/run.auth/webapp/package.json` (version)
- Modify: `docs/superpowers/specs/2026-07-12-ip-visibility-design.md` (append an implementation note)

- [ ] **Step 1: Bump the version.** Read the current `version` in `apps/run.auth/webapp/package.json` (currently `0.1.0`) and bump the patch (→ `0.1.1`). If Task-1 already touched the file, just change `version`. If the Altcha PR has merged first and moved it, bump the patch from the actual current value and note it.

- [ ] **Step 2: Append an implementation note** to `docs/superpowers/specs/2026-07-12-ip-visibility-design.md`:

```md
## v1 Implementation Notes (delivered)

- **No Terraform/IAM change was needed.** The shared `app`-cluster ECS task role
  already grants `logs:*` on `*` (+ `CloudWatchFullAccessV2`), so the CloudWatch
  Logs client uses the default credential provider chain (task-role creds). The
  spec's "IAM (Terraform)" section is superseded — no least-privilege statement was
  added (doing so would require editing the shared `ecs-cluster` module, affecting
  every service; not worth it for read-only Insights on our own log group).
- **Per-region:** the log group is `/ecs/run-auth-app-run-auth-${REGION_SHORT}-dc34`;
  each region's console queries its own region. Cross-region aggregation is a follow-up.
- **Query injection:** `ip` (shape) and `userId` (id-charset) are validated → 400
  before interpolation, even though the routes are admin-gated.
- **Insights latency:** queries poll (StartQuery→GetQueryResults) with a ~10s cap;
  on timeout the route returns `partial:true` and StopQuery is best-effort called.

### Follow-ups (not in v1)
- WAF-block action (add IP to CloudFront WAFv2 IPSet) — its own spec.
- Cross-region log aggregation; standing "shared IP (N accounts)" report.
- Caching the IP-lookup direction if the log group grows.
```

- [ ] **Step 3: Verify + commit.** `npx vitest run` green, `npx tsc --noEmit` clean.

```bash
git add apps/run.auth/webapp/package.json docs/superpowers/specs/2026-07-12-ip-visibility-design.md
git commit -m "docs(auth-admin): IP-visibility v1 notes (no IAM needed); bump run.auth 0.1.1"
```

---

## Deploy (after merge approval)

No infra apply required (IAM already present). Standard app release: PR → merge → `buildpub` (skip_region drops cac1/apse1) → `deploy.yml` us-east-1. Verify by opening `/use1/admin` as an admin, opening a user drawer (login IPs populate within ~1-5s), and using the IP-lookup panel. Logs: `aws logs tail /ecs/run-auth-app-run-auth-use1-dc34 --profile ...`.

---

## Self-Review

- **Spec coverage:** `runInsights` + two queries ✅(T1); IAM — N/A, already granted, documented ✅(T4); two admin routes ✅(T2); drawer login-IPs section + top-level IP-lookup panel, cross-linked ✅(T3); IP-shape validation ✅(T1/T2). Out-of-scope (WAF block, cross-region, shared-IP report) documented ✅(T4).
- **Placeholders:** none — full code for T1/T2, concrete JSX + exact tokens for T3 with an executor note to match live line numbers.
- **Type consistency:** `runInsights` returns `{rows, partial}` everywhere; route response field names (`ips`/`users`/`partial`) match the UI's `IpRow`/`UserRow` shapes; `BASE` prefix on every new fetch.
