# Auth Identity & Sessions Admin Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only console at `auth.defcon.run/admin` that lists auth-layer identities (one row per `AuthProfile`), shows which OAuth providers linked each one and when, resolves the downstream run.human user live, and offers lock/unlink/hard-delete actions.

**Architecture:** New surface entirely inside `apps/run.auth/webapp/src`. A framework-neutral session-group gate (`services ∋ admin|runadmin`) with in-process live revalidation. The identity list is a merge of an `AuthProfile` scan (identity spine: displayName, email, services, lockout, createdAt) and an authjs-adapter `ACCOUNT#` scan (authoritative provider truth, incl. LinkedIn which has no AuthProfile map). run.human tie-back reuses run.human's existing secret-gated internal endpoint via a run.auth-side resolver that fans out for the visible page. Destructive actions reuse the existing lockout mechanics and are run.auth-only (cascade deferred).

**Tech Stack:** Next.js 16 (App Router), React 19, HeroUI + Tailwind 4, next-auth v5 (JWT sessions), ElectroDB + AWS SDK v3 DynamoDBDocument, vitest 4.

## Global Constraints

- **Node ≥ 22.12 for vitest** — run `nvm use 23.6.0` before any `npx vitest` (default host Node fails to start vitest; looks like a test failure but is environmental).
- **Non-disclosure gate** — every admin page/route denial maps to **HTTP 404** (or `notFound()`), NEVER 401/403. Route existence is not advertised.
- **Admin grant source is `session.user.services` only** — groups `admin` or `runadmin`. No email allowlist, no other grant source.
- **Live revalidation is in-process** — run.auth IS the auth server; read `AuthProfile` directly via `getAuthProfile(userId)`. Do NOT call `revalidateAdmin` over HTTP.
- **`session.user` shape in run.auth** — `session.user.id` (= `token.sub` = `AuthProfile.userId` = OIDC sub) and `session.user.services: string[]`. Within run.auth there is ONE id namespace (no adapter-uuid vs sub split — that split only exists in run.human).
- **Emails are PII** — bulk JSON responses carry only masked emails; full email is revealed one identity at a time via the drawer detail route. Server-side email search never returns bulk full emails.
- **Routes** — every route handler and the page set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- **No request-body logging** in mutation routes (log errors only).
- **CSV formula-injection guard** — displayName/email are attacker-controllable; the CSV cell escaper must neutralise leading `= + - @` (see Task 2).
- **DynamoDB access** — authjs adapter table via `dynamodbClient` + `DYNAMODB_TABLE`; ElectroDB entities via their own methods; both from `@/entities/client`.

---

## File Structure

Created in `apps/run.auth/webapp/src`:

| File | Responsibility |
|---|---|
| `lib/admin-gate.ts` | Session-group gate: `isAdmin`, `requireAdmin`, in-process `revalidateAdmin`. |
| `lib/identity-report.ts` | Pure: types, `maskEmail`, `csvCell`/`toCsv` (injection-safe), `mergeIdentityRows`, `deriveProviders`, filters, sort, `summaryTiles`. |
| `entities/admin-identity.ts` | Data-access: `scanAuthProfiles`, `scanAllAccounts`, `getAccountsForUser`, `getOidcSessionsForUser`, `deleteAccountRow`, `deleteIdentity` (run.auth-only cascade). |
| `lib/runhuman-resolve.ts` | Calls run.human internal endpoint; `resolveRunHuman(sub)` + `resolveRunHumanMany(subs)`, fail-soft. |
| `app/admin/layout.tsx` | Own full-page shell (no app chrome to inherit). |
| `app/admin/page.tsx` | Server component: gate + initial masked rows + summary tiles. |
| `app/admin/AdminConsole.tsx` | `"use client"`: table, filters, pager, drawer, lazy run.human fill. |
| `app/admin/AdminActions.tsx` | `"use client"`: lock/unlink/delete buttons + confirm modals. |
| `app/api/admin/identities/route.ts` | `GET` masked JSON (paginated + `?q=` search) + `?format=csv`. |
| `app/api/admin/identities/resolve-runhuman/route.ts` | `POST { userIds }` → run.human map (visible-page fan-out). |
| `app/api/admin/identities/[userId]/route.ts` | `GET` drawer detail; `DELETE` hard delete (run.auth-only). |
| `app/api/admin/identities/[userId]/lock/route.ts` | `POST { locked, reason? }`. |
| `app/api/admin/identities/[userId]/unlink/route.ts` | `POST { provider, providerAccountId }`. |

Modified in `apps/run.human/webapp/src`:

| File | Responsibility |
|---|---|
| `app/api/internal/user/[oidcSub]/route.ts` | Add `?summary=1` branch to existing `GET` returning only `{ found, runUserId, displayName }` (least-privilege — no mqtt secrets to run.auth). |

---

## Task 1: Admin gate (run.auth)

**Files:**
- Create: `apps/run.auth/webapp/src/lib/admin-gate.ts`
- Test: `apps/run.auth/webapp/src/lib/admin-gate.test.ts`

**Interfaces:**
- Produces: `ADMIN_GROUPS`, `isAdmin(session): boolean`, `requireAdmin(session): RequireAdminResult`, `revalidateAdmin(userId): Promise<boolean>`, types `SessionLike` / `RequireAdminResult`.
- Consumes: `getAuthProfile` from `@/entities/auth-profile`.

- [ ] **Step 1: Write the failing test**

`apps/run.auth/webapp/src/lib/admin-gate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isAdmin, requireAdmin, ADMIN_GROUPS } from "./admin-gate";

describe("isAdmin", () => {
  it("admits admin group", () => {
    expect(isAdmin({ user: { services: ["run", "admin"] } })).toBe(true);
  });
  it("admits runadmin group", () => {
    expect(isAdmin({ user: { services: ["runadmin"] } })).toBe(true);
  });
  it("rejects non-admin services", () => {
    expect(isAdmin({ user: { services: ["run", "flash"] } })).toBe(false);
  });
  it("rejects missing/empty session", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ user: {} })).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("no_session when unauthenticated", () => {
    expect(requireAdmin(null)).toEqual({ ok: false, reason: "no_session" });
  });
  it("not_admin when authenticated without group", () => {
    expect(requireAdmin({ user: { services: ["run"], email: "a@b.c" } }))
      .toEqual({ ok: false, reason: "not_admin" });
  });
  it("ok with email when admin", () => {
    expect(requireAdmin({ user: { services: ["admin"], email: "a@b.c" } }))
      .toEqual({ ok: true, email: "a@b.c" });
  });
  it("exposes the group list", () => {
    expect(ADMIN_GROUPS).toContain("admin");
    expect(ADMIN_GROUPS).toContain("runadmin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 23.6.0 && npx vitest run src/lib/admin-gate.test.ts`
Expected: FAIL — cannot resolve `./admin-gate`.

- [ ] **Step 3: Write minimal implementation**

`apps/run.auth/webapp/src/lib/admin-gate.ts`:
```ts
/**
 * run.auth admin gate. Group-claim based: admin access is granted ONLY via
 * `admin` or `runadmin` in the session's `services` list (the AuthProfile
 * "groups" model, surfaced on the Auth.js session as session.user.services).
 * No email allowlist.
 *
 * Non-disclosure: callers map BOTH failure reasons to a 404 (never 401/403).
 * Framework-neutral (imports no Next.js) so page and route handlers share it.
 *
 * Live revalidation is IN-PROCESS here (run.auth IS the auth server): we read
 * AuthProfile directly rather than over HTTP. Fail-closed on any error.
 */
import { getAuthProfile } from "@/entities/auth-profile";

export type SessionLike =
  | { user?: { services?: string[] | null; email?: string | null; id?: string | null } | null }
  | null
  | undefined;

export const ADMIN_GROUPS = ["admin", "runadmin"] as const;

export function isAdmin(session: SessionLike): boolean {
  const services = session?.user?.services;
  return (
    Array.isArray(services) &&
    services.some((s) => (ADMIN_GROUPS as readonly string[]).includes(s))
  );
}

export type RequireAdminResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "no_session" | "not_admin" };

export function requireAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) return { ok: false, reason: "no_session" };
  if (!isAdmin(session)) return { ok: false, reason: "not_admin" };
  return { ok: true, email: session.user.email ?? null };
}

/**
 * Live re-check against the AuthProfile groups model to defeat the ~5-min JWT
 * staleness window. Grants on admin||runadmin AND not locked out. Fail-closed.
 */
export async function revalidateAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const profile = await getAuthProfile(userId);
    if (!profile || profile.lockedOut) return false;
    const services = profile.services ?? [];
    return services.some((s) => (ADMIN_GROUPS as readonly string[]).includes(s));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 23.6.0 && npx vitest run src/lib/admin-gate.test.ts`
Expected: PASS (all cases). `revalidateAdmin` is exercised at integration time (it hits DynamoDB); the pure gate logic is fully covered here.

- [ ] **Step 5: Commit**

```bash
git add apps/run.auth/webapp/src/lib/admin-gate.ts apps/run.auth/webapp/src/lib/admin-gate.test.ts
git commit -m "feat(auth-admin): session-group admin gate with in-process revalidation"
```

---

## Task 2: Pure report helpers (`identity-report.ts`)

**Files:**
- Create: `apps/run.auth/webapp/src/lib/identity-report.ts`
- Test: `apps/run.auth/webapp/src/lib/identity-report.test.ts`

**Interfaces:**
- Produces:
  - Types `ProviderKey = "github"|"discord"|"linkedin"|"strava"|"email"`, `AccountRow`, `ProfileRow`, `IdentityRow`, `IdentitySort`, `SummaryTiles`.
  - `maskEmail(email): string`
  - `csvCell(value): string`, `toCsv(columns, rows): string` (injection-safe)
  - `deriveProviders(accounts, lastProvider): ProviderKey[]`
  - `linkedAtFor(profile, provider): number | null`
  - `mergeIdentityRows(profiles, accountsByUser): IdentityRow[]`
  - `filterByEmail(rows, q): IdentityRow[]`
  - `sortRows(rows, sort): IdentityRow[]`
  - `summaryTiles(rows): SummaryTiles`
- Consumes: nothing (pure). Type shapes below are the contract Task 3 and Task 5 build against.

- [ ] **Step 1: Write the failing test**

`apps/run.auth/webapp/src/lib/identity-report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  maskEmail, csvCell, toCsv, deriveProviders, mergeIdentityRows,
  filterByEmail, sortRows, summaryTiles,
  type ProfileRow, type AccountRow,
} from "./identity-report";

describe("maskEmail", () => {
  it("masks local part", () => expect(maskEmail("kurt@gmail.com")).toBe("k•••@gmail.com"));
  it("empty for null", () => expect(maskEmail(null)).toBe(""));
  it("bullet for malformed", () => expect(maskEmail("nope")).toBe("•••"));
});

describe("csvCell injection guard", () => {
  it("quotes commas/quotes/newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });
  it("neutralises leading formula chars", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@x")).toBe("'@x");
  });
  it("passes plain text", () => expect(csvCell("rabbit_A1B2")).toBe("rabbit_A1B2"));
});

describe("toCsv", () => {
  it("serialises header + rows", () => {
    const csv = toCsv(
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
      [{ a: "1", b: "2" }, { a: "x,y", b: "=z" }],
    );
    expect(csv).toBe('A,B\n1,2\n"x,y",\'=z');
  });
});

describe("deriveProviders", () => {
  it("unions account providers with email fallback", () => {
    const accts: AccountRow[] = [
      { provider: "github", providerAccountId: "1", userId: "u1" },
      { provider: "linkedin", providerAccountId: "2", userId: "u1" },
    ];
    expect(deriveProviders(accts, "email").sort()).toEqual(["email", "github", "linkedin"]);
  });
  it("dedups and ignores unknown lastProvider", () => {
    const accts: AccountRow[] = [{ provider: "discord", providerAccountId: "9", userId: "u1" }];
    expect(deriveProviders(accts, "discord")).toEqual(["discord"]);
  });
});

describe("mergeIdentityRows", () => {
  const profiles: ProfileRow[] = [
    { userId: "u1", displayName: "rabbit_A", email: "a@x.com", services: ["run", "admin"],
      lastProvider: "github", createdAt: 1000, lockedOut: false,
      github: { linkedAt: 1000 }, discord: null, strava: null },
    { userId: "u2", displayName: "rabbit_B", email: "b@x.com", services: ["run"],
      lastProvider: "email", createdAt: 2000, lockedOut: true,
      github: null, discord: null, strava: null },
  ];
  const accountsByUser = {
    u1: [{ provider: "github", providerAccountId: "g1", userId: "u1" },
         { provider: "linkedin", providerAccountId: "l1", userId: "u1" }],
    u2: [],
  };
  it("builds one row per profile with merged providers", () => {
    const rows = mergeIdentityRows(profiles, accountsByUser);
    const u1 = rows.find((r) => r.userId === "u1")!;
    expect(u1.providers.sort()).toEqual(["github", "linkedin"]);
    expect(u1.providerCount).toBe(2);
    expect(u1.emailMasked).toBe("a•••@x.com");
    expect(u1.emailFull).toBe("a@x.com");
    const u2 = rows.find((r) => r.userId === "u2")!;
    expect(u2.lockedOut).toBe(true);
    expect(u2.providers).toEqual(["email"]); // no accounts, lastProvider=email
  });
});

describe("filter/sort/summary", () => {
  const profiles: ProfileRow[] = [
    { userId: "u1", displayName: "r_A", email: "alice@x.com", services: ["run"],
      lastProvider: "github", createdAt: 1000, lockedOut: false, github: { linkedAt: 1000 }, discord: null, strava: null },
    { userId: "u2", displayName: "r_B", email: "bob@x.com", services: ["run"],
      lastProvider: "discord", createdAt: 5000, lockedOut: false, github: null, discord: { linkedAt: 5000 }, strava: null },
  ];
  const rows = mergeIdentityRows(profiles, { u1: [{ provider: "github", providerAccountId: "1", userId: "u1" }], u2: [{ provider: "discord", providerAccountId: "2", userId: "u2" }] });
  it("filters by full email substring", () => {
    expect(filterByEmail(rows, "alice").map((r) => r.userId)).toEqual(["u1"]);
    expect(filterByEmail(rows, "").length).toBe(2);
  });
  it("sorts by createdAt desc", () => {
    expect(sortRows(rows, "created").map((r) => r.userId)).toEqual(["u2", "u1"]);
  });
  it("summary counts", () => {
    const t = summaryTiles(rows);
    expect(t.totalIdentities).toBe(2);
    expect(t.multiProvider).toBe(0);
    expect(t.locked).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 23.6.0 && npx vitest run src/lib/identity-report.test.ts`
Expected: FAIL — cannot resolve `./identity-report`.

- [ ] **Step 3: Write minimal implementation**

`apps/run.auth/webapp/src/lib/identity-report.ts`:
```ts
/**
 * Pure assembly for the auth identity admin dashboard. NEVER import into a
 * client component with emailFull populated — the route masks/reveals.
 */

export type ProviderKey = "github" | "discord" | "linkedin" | "strava" | "email";

/** One OAuth ACCOUNT# row from the authjs adapter table. */
export type AccountRow = {
  provider: string;            // "github" | "discord" | "linkedin" | "strava" | ...
  providerAccountId: string;
  userId: string;              // AuthProfile.userId (= OIDC sub)
};

/** Projection of an AuthProfile needed for the report (Task 3 supplies this). */
export type ProfileRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
  services: string[];
  lastProvider: string | null;
  createdAt: number | null;
  lockedOut: boolean;
  github: { linkedAt?: number } | null;
  discord: { linkedAt?: number } | null;
  strava: { linkedAt?: number } | null;
};

export type IdentityRow = {
  userId: string;
  displayName: string;
  emailFull: string | null;
  emailMasked: string;
  services: string[];
  providers: ProviderKey[];
  providerCount: number;
  lastProvider: string | null;
  createdAt: number | null;
  lockedOut: boolean;
  linkedAt: Partial<Record<ProviderKey, number>>;
};

export type IdentitySort = "created" | "providers" | "displayName";

export type SummaryTiles = {
  totalIdentities: number;
  new24h: number;
  multiProvider: number;
  locked: number;
};

const KNOWN_PROVIDERS: ProviderKey[] = ["github", "discord", "linkedin", "strava", "email"];

export function maskEmail(email: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/**
 * RFC-4180 escape PLUS spreadsheet formula-injection guard: values beginning
 * with = + - @ are prefixed with a single quote so Excel/Sheets treat them as
 * text. displayName/email are attacker-controllable, so this is mandatory.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; header: string }[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return [head, ...body].join("\n");
}

/** Union of providers present in ACCOUNT rows, plus `email` if lastProvider says so. */
export function deriveProviders(accounts: AccountRow[], lastProvider: string | null): ProviderKey[] {
  const set = new Set<ProviderKey>();
  for (const a of accounts) {
    if ((KNOWN_PROVIDERS as string[]).includes(a.provider)) set.add(a.provider as ProviderKey);
  }
  if (lastProvider === "email") set.add("email");
  // An identity with no account rows but an email login still shows `email`.
  if (set.size === 0 && lastProvider === "email") set.add("email");
  return [...set];
}

/** linkedAt timestamp for a provider from the AuthProfile maps (null if absent). */
export function linkedAtFor(profile: ProfileRow, provider: ProviderKey): number | null {
  if (provider === "github") return profile.github?.linkedAt ?? null;
  if (provider === "discord") return profile.discord?.linkedAt ?? null;
  if (provider === "strava") return profile.strava?.linkedAt ?? null;
  return null; // linkedin/email have no AuthProfile map
}

export function mergeIdentityRows(
  profiles: ProfileRow[],
  accountsByUser: Record<string, AccountRow[]>,
): IdentityRow[] {
  return profiles.map((p) => {
    const accounts = accountsByUser[p.userId] ?? [];
    const providers = deriveProviders(accounts, p.lastProvider);
    const linkedAt: Partial<Record<ProviderKey, number>> = {};
    for (const prov of providers) {
      const t = linkedAtFor(p, prov);
      if (t != null) linkedAt[prov] = t;
    }
    return {
      userId: p.userId,
      displayName: p.displayName ?? "",
      emailFull: p.email ?? null,
      emailMasked: maskEmail(p.email ?? null),
      services: p.services ?? [],
      providers,
      providerCount: providers.length,
      lastProvider: p.lastProvider ?? null,
      createdAt: p.createdAt ?? null,
      lockedOut: p.lockedOut,
      linkedAt,
    };
  });
}

export function filterByEmail(rows: IdentityRow[], q: string): IdentityRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => (r.emailFull ?? "").toLowerCase().includes(needle));
}

export function sortRows(rows: IdentityRow[], sort: IdentitySort): IdentityRow[] {
  const cmp: Record<IdentitySort, (a: IdentityRow, b: IdentityRow) => number> = {
    created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    providers: (a, b) => b.providerCount - a.providerCount,
    displayName: (a, b) => a.displayName.localeCompare(b.displayName),
  };
  return [...rows].sort(cmp[sort]);
}

export function summaryTiles(rows: IdentityRow[]): SummaryTiles {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return {
    totalIdentities: rows.length,
    new24h: rows.filter((r) => r.createdAt != null && now - r.createdAt <= DAY).length,
    multiProvider: rows.filter((r) => r.providerCount > 1).length,
    locked: rows.filter((r) => r.lockedOut).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 23.6.0 && npx vitest run src/lib/identity-report.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/run.auth/webapp/src/lib/identity-report.ts apps/run.auth/webapp/src/lib/identity-report.test.ts
git commit -m "feat(auth-admin): pure identity-report helpers (merge, providers, injection-safe CSV)"
```

---

## Task 3: Data-access layer (`entities/admin-identity.ts`)

**Files:**
- Create: `apps/run.auth/webapp/src/entities/admin-identity.ts`
- Test: `apps/run.auth/webapp/src/entities/admin-identity.test.ts` (pure grouping helper only)

**Interfaces:**
- Consumes: `dynamodbClient`, `DYNAMODB_TABLE` from `@/entities/client`; `AuthProfile` from `@/entities/auth-profile`; `AccountRow`, `ProfileRow` types from `@/lib/identity-report`.
- Produces:
  - `groupAccountsByUser(items): Record<string, AccountRow[]>` (pure, exported for test)
  - `scanAuthProfiles(): Promise<ProfileRow[]>`
  - `scanAllAccounts(): Promise<AccountRow[]>`
  - `getAccountsForUser(userId): Promise<AccountRow[]>`
  - `getOidcSessionsForUser(accountId): Promise<OidcSessionRow[]>`, type `OidcSessionRow = { id: string; expiresAt: number | null }`
  - `deleteAccountRow(userId, provider, providerAccountId): Promise<void>`
  - `deleteIdentity(userId): Promise<{ deletedAccounts: number; deletedOidc: number }>` (run.auth-only: AuthProfile + all ACCOUNT# rows + USER# row + OIDC grants/sessions for accountId)

- [ ] **Step 1: Write the failing test (pure grouping helper)**

`apps/run.auth/webapp/src/entities/admin-identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupAccountsByUser } from "./admin-identity";

describe("groupAccountsByUser", () => {
  it("groups ACCOUNT rows by userId and drops non-account items", () => {
    const items = [
      { pk: "USER#u1", sk: "ACCOUNT#github#g1", userId: "u1", provider: "github", providerAccountId: "g1" },
      { pk: "USER#u1", sk: "ACCOUNT#linkedin#l1", userId: "u1", provider: "linkedin", providerAccountId: "l1" },
      { pk: "USER#u2", sk: "USER#u2", userId: "u2" }, // not an account row
    ];
    const grouped = groupAccountsByUser(items);
    expect(grouped.u1.map((a) => a.provider).sort()).toEqual(["github", "linkedin"]);
    expect(grouped.u2).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 23.6.0 && npx vitest run src/entities/admin-identity.test.ts`
Expected: FAIL — cannot resolve `./admin-identity`.

- [ ] **Step 3: Write implementation**

`apps/run.auth/webapp/src/entities/admin-identity.ts`:
```ts
/**
 * Admin data-access for the auth identity dashboard. Reads the authjs adapter
 * table (USER#/ACCOUNT# rows) via the raw document client and the AuthProfile /
 * OIDCModel ElectroDB entities. Server-only.
 */
import { dynamodbClient, DYNAMODB_TABLE } from "./client";
import { AuthProfile } from "./auth-profile";
import { OIDCModel } from "./oidc-adapter";
import type { AccountRow, ProfileRow } from "@/lib/identity-report";

export type OidcSessionRow = { id: string; expiresAt: number | null };

/** Pure: fold raw authjs items into userId → AccountRow[] (ACCOUNT# rows only). */
export function groupAccountsByUser(items: Record<string, unknown>[]): Record<string, AccountRow[]> {
  const out: Record<string, AccountRow[]> = {};
  for (const it of items) {
    const sk = String(it.sk ?? "");
    if (!sk.startsWith("ACCOUNT#")) continue;
    const userId = String(it.userId ?? "");
    if (!userId) continue;
    (out[userId] ??= []).push({
      provider: String(it.provider ?? ""),
      providerAccountId: String(it.providerAccountId ?? ""),
      userId,
    });
  }
  return out;
}

/** Scan all AuthProfile rows → ProfileRow projection. */
export async function scanAuthProfiles(): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = [];
  let cursor: string | null = null;
  do {
    const page = await AuthProfile.scan.go({ cursor, limit: 200 });
    for (const p of page.data) {
      rows.push({
        userId: p.userId,
        displayName: p.displayName ?? null,
        email: p.email ?? null,
        services: p.services ?? [],
        lastProvider: p.lastProvider ?? null,
        createdAt: p.createdAt ?? null,
        lockedOut: p.lockedOut ?? false,
        github: p.github ?? null,
        discord: p.discord ?? null,
        strava: p.strava ?? null,
      });
    }
    cursor = page.cursor;
  } while (cursor);
  return rows;
}

/** One paginated scan of ACCOUNT# rows across the authjs table. */
export async function scanAllAccounts(): Promise<AccountRow[]> {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamodbClient.scan({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "begins_with(sk, :acct)",
      ExpressionAttributeValues: { ":acct": "ACCOUNT#" },
      ProjectionExpression: "userId, provider, providerAccountId, sk",
      ExclusiveStartKey,
    });
    if (res.Items) items.push(...(res.Items as Record<string, unknown>[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return Object.values(groupAccountsByUser(items)).flat();
}

/** ACCOUNT# rows for a single identity (drawer). */
export async function getAccountsForUser(userId: string): Promise<AccountRow[]> {
  const res = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :acct)",
    ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":acct": "ACCOUNT#" },
  });
  return (res.Items ?? []).map((it) => ({
    provider: String(it.provider ?? ""),
    providerAccountId: String(it.providerAccountId ?? ""),
    userId,
  }));
}

/** Live OIDC SSO Session rows whose payload.accountId == this identity's sub. */
export async function getOidcSessionsForUser(accountId: string): Promise<OidcSessionRow[]> {
  const res = await OIDCModel.query.primary({ modelName: "Session" }).go({ limit: 500 });
  return res.data
    .filter((r: any) => r?.payload?.accountId === accountId)
    .map((r: any) => ({ id: r.id, expiresAt: r.expiresAt ?? null }));
}

/** Delete a single ACCOUNT# row (unlink one provider). */
export async function deleteAccountRow(userId: string, provider: string, providerAccountId: string): Promise<void> {
  await dynamodbClient.delete({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `ACCOUNT#${provider}#${providerAccountId}` },
  });
}

/**
 * Hard delete within run.auth ONLY: AuthProfile row + all ACCOUNT# rows + the
 * USER# row + any OIDC Session/Grant rows for this accountId. Does NOT touch
 * run.human/bib (cascade is a separate phase).
 */
export async function deleteIdentity(userId: string): Promise<{ deletedAccounts: number; deletedOidc: number }> {
  // 1. accounts
  const accounts = await getAccountsForUser(userId);
  for (const a of accounts) {
    await deleteAccountRow(userId, a.provider, a.providerAccountId);
  }
  // 2. USER# row
  await dynamodbClient.delete({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
  });
  // 3. OIDC sessions for this accountId
  const sessions = await getOidcSessionsForUser(userId);
  for (const s of sessions) {
    await OIDCModel.delete({ modelName: "Session", id: s.id }).go();
  }
  // 4. AuthProfile
  await AuthProfile.delete({ userId }).go();
  return { deletedAccounts: accounts.length, deletedOidc: sessions.length };
}
```

> **Note for implementer:** verify `AuthProfile.scan.go({ cursor, limit })` and `OIDCModel.query.primary(...)` shapes against the installed ElectroDB version (`grep -rn "\.scan\." apps/run.auth/webapp/src` for existing usage, e.g. `services/auth-profile.services.ts`). If `scan.go` doesn't accept a cursor object in this version, use the pattern already present in the repo. Do NOT invent an API — match existing call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 23.6.0 && npx vitest run src/entities/admin-identity.test.ts`
Expected: PASS (grouping helper). The DynamoDB functions are integration-verified in Task 11 (local dynamo) / staging.

- [ ] **Step 5: Commit**

```bash
git add apps/run.auth/webapp/src/entities/admin-identity.ts apps/run.auth/webapp/src/entities/admin-identity.test.ts
git commit -m "feat(auth-admin): identity data-access (scan profiles+accounts, oidc sessions, delete)"
```

---

## Task 4: run.human resolver (`lib/runhuman-resolve.ts`)

**Files:**
- Create: `apps/run.auth/webapp/src/lib/runhuman-resolve.ts`
- Test: `apps/run.auth/webapp/src/lib/runhuman-resolve.test.ts`

**Interfaces:**
- Consumes: `config` from `@/config` (for `config.auth.internalSecret`); a run.human base URL (env `RUN_HUMAN_INTERNAL_URL`, default `https://run.defcon.run`).
- Produces:
  - Type `RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null }`
  - `resolveRunHuman(sub, fetchImpl?): Promise<RunHumanRef>` (fail-soft → `{found:false,...}`)
  - `resolveRunHumanMany(subs, fetchImpl?): Promise<Record<string, RunHumanRef>>` (bounded concurrency 8)

- [ ] **Step 1: Write the failing test**

`apps/run.auth/webapp/src/lib/runhuman-resolve.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { resolveRunHuman, resolveRunHumanMany } from "./runhuman-resolve";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("resolveRunHuman", () => {
  it("maps a found run.human user", async () => {
    const f = mockFetch(200, { found: true, runUserId: "rh1", displayName: "rabbit_Z" });
    const ref = await resolveRunHuman("sub1", f);
    expect(ref).toEqual({ found: true, runUserId: "rh1", displayName: "rabbit_Z" });
  });
  it("fail-soft on 404", async () => {
    const ref = await resolveRunHuman("subX", mockFetch(404, { error: "x" }));
    expect(ref).toEqual({ found: false, runUserId: null, displayName: null });
  });
  it("fail-soft on network throw", async () => {
    const f = vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    expect(await resolveRunHuman("subX", f)).toEqual({ found: false, runUserId: null, displayName: null });
  });
});

describe("resolveRunHumanMany", () => {
  it("resolves a map keyed by sub", async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({ found: true, runUserId: "rh-" + url.split("/").pop(), displayName: "d" }),
    })) as unknown as typeof fetch;
    const map = await resolveRunHumanMany(["a", "b"], f);
    expect(map.a.runUserId).toBe("rh-a?summary=1");
    expect(map.b.found).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 23.6.0 && npx vitest run src/lib/runhuman-resolve.test.ts`
Expected: FAIL — cannot resolve `./runhuman-resolve`.

- [ ] **Step 3: Write implementation**

`apps/run.auth/webapp/src/lib/runhuman-resolve.ts`:
```ts
/**
 * Resolve an OIDC sub (= AuthProfile.userId) to its downstream run.human user
 * via run.human's existing secret-gated internal endpoint. Fail-soft: any error
 * or non-2xx yields {found:false} — the auth data is authoritative, the
 * run.human column is best-effort.
 */
import { config } from "@/config";

export type RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null };

const NONE: RunHumanRef = { found: false, runUserId: null, displayName: null };
const BASE = process.env.RUN_HUMAN_INTERNAL_URL || "https://run.defcon.run";

export async function resolveRunHuman(sub: string, fetchImpl: typeof fetch = fetch): Promise<RunHumanRef> {
  try {
    const res = await fetchImpl(`${BASE}/api/internal/user/${encodeURIComponent(sub)}?summary=1`, {
      headers: { "x-internal-secret": config.auth.internalSecret ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return NONE;
    const body = (await res.json()) as Partial<RunHumanRef>;
    return {
      found: body.found === true || body.runUserId != null,
      runUserId: body.runUserId ?? null,
      displayName: body.displayName ?? null,
    };
  } catch {
    return NONE;
  }
}

export async function resolveRunHumanMany(subs: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, RunHumanRef>> {
  const out: Record<string, RunHumanRef> = {};
  const CONCURRENCY = 8;
  let i = 0;
  async function worker() {
    while (i < subs.length) {
      const idx = i++;
      const sub = subs[idx];
      out[sub] = await resolveRunHuman(sub, fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));
  return out;
}
```

> **Note:** the test asserts `rh-a?summary=1` because the mock echoes the URL tail — confirming the `?summary=1` query is sent. Confirm `config.auth.internalSecret` exists (`grep -n "internalSecret" apps/run.auth/webapp/src/config/index.ts`); it is already referenced by the run.human PATCH endpoint's counterpart.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 23.6.0 && npx vitest run src/lib/runhuman-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.auth/webapp/src/lib/runhuman-resolve.ts apps/run.auth/webapp/src/lib/runhuman-resolve.test.ts
git commit -m "feat(auth-admin): fail-soft run.human resolver (single + bounded bulk)"
```

---

## Task 5: run.human `?summary=1` branch (least-privilege)

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` (inside existing `GET`, after `getRunUser` succeeds, before the email lookup)

**Interfaces:**
- Produces: when `?summary=1`, GET returns `{ found: true, runUserId, displayName }` and nothing else (no mqtt secrets, no email).

- [ ] **Step 1: Add the summary short-circuit**

In the existing `GET`, immediately after the `if (!user) { ... 404 }` block (around line 73), insert:
```ts
    // Least-privilege summary for the run.auth admin dashboard tie-back:
    // only the run.human id + display name cross the wire, never mqtt secrets.
    const url = new URL(req.url);
    if (url.searchParams.get("summary") === "1") {
      return NextResponse.json({
        found: true,
        runUserId: user.userId,
        displayName: user.displayName,
      });
    }
```

- [ ] **Step 2: Type-check**

Run: `cd apps/run.human/webapp && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
git commit -m "feat(run.human): summary=1 branch on internal user GET for auth admin tie-back"
```

---

## Task 6: List route — `GET /api/admin/identities` (JSON + CSV + search)

**Files:**
- Create: `apps/run.auth/webapp/src/app/api/admin/identities/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/config/auth` (or wherever run.auth exports the session helper — `grep -rn "export .*auth" apps/run.auth/webapp/src/config/auth.ts`), `requireAdmin`/`revalidateAdmin` (Task 1), `scanAuthProfiles`/`scanAllAccounts` (Task 3), `mergeIdentityRows`/`filterByEmail`/`sortRows`/`toCsv` (Task 2).
- Produces: `GET` returning `{ rows: MaskedRow[] }` (masked, `q`/`sort` applied) or CSV attachment when `?format=csv`. `MaskedRow` omits `emailFull`.

- [ ] **Step 1: Write the route**

`apps/run.auth/webapp/src/app/api/admin/identities/route.ts`:
```ts
import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAuthProfiles, scanAllAccounts, groupAccountsByUser } from "@/entities/admin-identity";
import { mergeIdentityRows, filterByEmail, sortRows, toCsv, type IdentitySort, type IdentityRow } from "@/lib/identity-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

function maskRow(r: IdentityRow) {
  const { emailFull: _drop, ...rest } = r;
  return rest;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  if (!(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = (url.searchParams.get("sort") as IdentitySort) || "created";
  const format = url.searchParams.get("format");

  const [profiles, accounts] = await Promise.all([scanAuthProfiles(), scanAllAccounts()]);
  const accountsByUser = groupAccountsByUser(accounts as unknown as Record<string, unknown>[]);
  let rows = sortRows(mergeIdentityRows(profiles, accountsByUser), sort);
  if (q) rows = filterByEmail(rows, q);

  if (format === "csv") {
    const columns = [
      { key: "displayName", header: "displayName" },
      { key: "emailFull", header: "email" },
      { key: "providersJoined", header: "providers" },
      { key: "lastProvider", header: "lastProvider" },
      { key: "createdAtIso", header: "createdAt" },
      { key: "services", header: "services" },
      { key: "lockedOut", header: "lockedOut" },
      { key: "userId", header: "userId" },
    ];
    const csvRows = rows.map((r) => ({
      ...r,
      providersJoined: r.providers.join("|"),
      createdAtIso: r.createdAt ? new Date(r.createdAt).toISOString() : "",
      services: r.services.join("|"),
    }));
    const today = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(columns, csvRows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auth-identities-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.json({ rows: rows.map(maskRow) }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit`
Expected: no new errors. If `auth` is not exported from `@/config/auth`, adjust the import to the actual session helper (check existing usage: `grep -rn "await auth()" apps/run.auth/webapp/src`).

- [ ] **Step 3: Manual smoke (non-admin → 404)**

Run dev server (`PORT=3002 npm run dev` in `apps/run.auth/webapp`), signed out:
`curl -i http://localhost:3002/api/admin/identities`
Expected: `HTTP/1.1 404`.

- [ ] **Step 4: Commit**

```bash
git add apps/run.auth/webapp/src/app/api/admin/identities/route.ts
git commit -m "feat(auth-admin): GET /api/admin/identities (masked JSON + CSV + email search)"
```

---

## Task 7: Bulk run.human resolve route — `POST /api/admin/identities/resolve-runhuman`

**Files:**
- Create: `apps/run.auth/webapp/src/app/api/admin/identities/resolve-runhuman/route.ts`

**Interfaces:**
- Consumes: gate (Task 1), `resolveRunHumanMany` (Task 4).
- Produces: `POST { userIds: string[] }` → `{ refs: Record<string, RunHumanRef> }`. Caps input at 100 ids.

- [ ] **Step 1: Write the route**

`apps/run.auth/webapp/src/app/api/admin/identities/resolve-runhuman/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { resolveRunHumanMany } from "@/lib/runhuman-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });
const bodySchema = z.object({ userIds: z.array(z.string().min(1)).max(100) });

export async function POST(req: NextRequest) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  if (!(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  const refs = await resolveRunHumanMany(parsed.userIds);
  return Response.json({ refs }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit`  → confirm `zod` is a dep (`grep '"zod"' package.json`; it's used across the monorepo — add if missing with `npm i zod`).
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/run.auth/webapp/src/app/api/admin/identities/resolve-runhuman/route.ts
git commit -m "feat(auth-admin): POST resolve-runhuman (visible-page tie-back fan-out)"
```

---

## Task 8: Drawer detail + hard delete — `/api/admin/identities/[userId]`

**Files:**
- Create: `apps/run.auth/webapp/src/app/api/admin/identities/[userId]/route.ts`

**Interfaces:**
- Consumes: gate (Task 1); `getAuthProfile` from `@/entities/auth-profile`; `getAccountsForUser`, `getOidcSessionsForUser`, `deleteIdentity` (Task 3); `resolveRunHuman` (Task 4); `maskEmail`... (uses full email — this is the reveal route).
- Produces:
  - `GET` → `{ identity: {...full email...}, accounts, oidcSessions, runHuman }`
  - `DELETE` → `{ ok: true, deletedAccounts, deletedOidc }`

- [ ] **Step 1: Write the route**

`apps/run.auth/webapp/src/app/api/admin/identities/[userId]/route.ts`:
```ts
import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { getAuthProfile } from "@/entities/auth-profile";
import { getAccountsForUser, getOidcSessionsForUser, deleteIdentity } from "@/entities/admin-identity";
import { resolveRunHuman } from "@/lib/runhuman-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: Awaited<ReturnType<typeof auth>>): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();
  const { userId } = await params;

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  const [accounts, oidcSessions, runHuman] = await Promise.all([
    getAccountsForUser(userId),
    getOidcSessionsForUser(userId),
    resolveRunHuman(userId),
  ]);

  return Response.json({
    identity: {
      userId,
      displayName: profile.displayName ?? "",
      email: profile.email ?? null, // FULL email — reveal route, admin-only
      services: profile.services ?? [],
      lastProvider: profile.lastProvider ?? null,
      createdAt: profile.createdAt ?? null,
      lockedOut: profile.lockedOut ?? false,
      lockoutReason: profile.lockoutReason ?? null,
      lockedAt: profile.lockedAt ?? null,
      sessionVersion: profile.sessionVersion ?? 1,
    },
    accounts,
    oidcSessions,
    runHuman,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();
  const { userId } = await params;

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  const result = await deleteIdentity(userId);
  return Response.json({ ok: true, ...result });
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/run.auth/webapp/src/app/api/admin/identities/[userId]/route.ts"
git commit -m "feat(auth-admin): identity detail GET + run.auth-only hard DELETE"
```

---

## Task 9: Lock + Unlink routes

**Files:**
- Create: `apps/run.auth/webapp/src/app/api/admin/identities/[userId]/lock/route.ts`
- Create: `apps/run.auth/webapp/src/app/api/admin/identities/[userId]/unlink/route.ts`

**Interfaces:**
- Consumes: gate (Task 1); `getAuthProfile`, `AuthProfile` from `@/entities/auth-profile`; `deleteAccountRow` (Task 3).
- Produces:
  - lock `POST { locked: boolean, reason?: string }` → `{ ok, lockedOut, sessionVersion }`
  - unlink `POST { provider: string, providerAccountId: string }` → `{ ok }` (also clears the matching AuthProfile map)

- [ ] **Step 1: Write the lock route** (mirrors existing `admin/user/[userId]/lock` mechanics — increment `sessionVersion`, set/clear `lockedOut` — but SESSION-gated, 404 on deny)

`apps/run.auth/webapp/src/app/api/admin/identities/[userId]/lock/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });
const bodySchema = z.object({ locked: z.boolean(), reason: z.string().max(280).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok || !(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  const { userId } = await params;
  let body;
  try { body = bodySchema.parse(await req.json()); } catch { return new Response(null, { status: 400 }); }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();
  const nextVersion = (profile.sessionVersion ?? 1) + 1;

  if (body.locked) {
    await AuthProfile.update({ userId }).set({
      lockedOut: true,
      sessionVersion: nextVersion,
      lockoutReason: body.reason || "Locked by admin console",
      lockedAt: Date.now(),
    }).go();
  } else {
    await AuthProfile.update({ userId })
      .set({ lockedOut: false, sessionVersion: nextVersion })
      .remove(["lockoutReason", "lockedAt"]).go();
  }
  return Response.json({ ok: true, lockedOut: body.locked, sessionVersion: nextVersion });
}
```

- [ ] **Step 2: Write the unlink route**

`apps/run.auth/webapp/src/app/api/admin/identities/[userId]/unlink/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";
import { deleteAccountRow } from "@/entities/admin-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });
const PROVIDER_MAPS = ["github", "discord", "strava"] as const;
const bodySchema = z.object({ provider: z.string().min(1), providerAccountId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok || !(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  const { userId } = await params;
  let body;
  try { body = bodySchema.parse(await req.json()); } catch { return new Response(null, { status: 400 }); }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();

  await deleteAccountRow(userId, body.provider, body.providerAccountId);
  // Clear the denormalised AuthProfile map for github/discord/strava (linkedin/email have none).
  if ((PROVIDER_MAPS as readonly string[]).includes(body.provider)) {
    await AuthProfile.update({ userId }).remove([body.provider as (typeof PROVIDER_MAPS)[number]]).go();
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/run.auth/webapp/src/app/api/admin/identities/[userId]/lock/route.ts" "apps/run.auth/webapp/src/app/api/admin/identities/[userId]/unlink/route.ts"
git commit -m "feat(auth-admin): session-gated lock + provider unlink routes"
```

---

## Task 10: Page shell + server component

**Files:**
- Create: `apps/run.auth/webapp/src/app/admin/layout.tsx`
- Create: `apps/run.auth/webapp/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `auth`, gate (Task 1), `scanAuthProfiles`/`scanAllAccounts`/`groupAccountsByUser` (Task 3), `mergeIdentityRows`/`sortRows`/`summaryTiles` (Task 2), `AdminConsole` (Task 11).
- Produces: gated page passing initial masked rows + tiles to `AdminConsole`.

- [ ] **Step 1: Write the layout**

`apps/run.auth/webapp/src/app/admin/layout.tsx`:
```tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
```

- [ ] **Step 2: Write the page**

`apps/run.auth/webapp/src/app/admin/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAuthProfiles, scanAllAccounts, groupAccountsByUser } from "@/entities/admin-identity";
import { mergeIdentityRows, sortRows, summaryTiles, type IdentityRow } from "@/lib/identity-report";
import AdminConsole from "./AdminConsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminIdentitiesPage() {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();
  if (!(await revalidateAdmin(session?.user?.id))) notFound();

  const [profiles, accounts] = await Promise.all([scanAuthProfiles(), scanAllAccounts()]);
  const rows = sortRows(
    mergeIdentityRows(profiles, groupAccountsByUser(accounts as unknown as Record<string, unknown>[])),
    "created",
  );
  const tiles = summaryTiles(rows);
  // Strip full emails before handing to the client component.
  const masked = rows.map(({ emailFull: _e, ...r }) => r) as Omit<IdentityRow, "emailFull">[];

  return <AdminConsole initialRows={masked} tiles={tiles} adminEmail={gate.email} />;
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit`
Expected: errors ONLY about the missing `./AdminConsole` (created next). Nothing else.

- [ ] **Step 4: Commit**

```bash
git add apps/run.auth/webapp/src/app/admin/layout.tsx apps/run.auth/webapp/src/app/admin/page.tsx
git commit -m "feat(auth-admin): gated /admin page shell + server data spine"
```

---

## Task 11: Client console + actions

**Files:**
- Create: `apps/run.auth/webapp/src/app/admin/AdminConsole.tsx`
- Create: `apps/run.auth/webapp/src/app/admin/AdminActions.tsx`

**Interfaces:**
- Consumes: masked `IdentityRow` (sans `emailFull`) + `SummaryTiles` from Task 2; routes from Tasks 6–9.
- Produces: interactive table, filters, drawer, and the action buttons.

- [ ] **Step 1: Write `AdminActions.tsx`**

`apps/run.auth/webapp/src/app/admin/AdminActions.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const dangerBtn = "text-[13px] font-semibold rounded-md px-3 py-1.5 border transition disabled:opacity-50";

export function LockAction({ userId, locked }: { userId: string; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!window.confirm(locked ? "Unlock this identity?" : "Lock out this identity? All their sessions are revoked immediately.")) return;
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/lock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !locked }),
    });
    setBusy(false);
    if (res.ok) router.refresh(); else setFailed(true);
  }
  return (
    <button onClick={go} disabled={busy}
      className={dangerBtn + " border-warning text-warning"}>
      {busy ? "…" : locked ? "Unlock" : "Lock out"}{failed ? " ✕" : ""}
    </button>
  );
}

export function UnlinkAction({ userId, provider, providerAccountId }: { userId: string; provider: string; providerAccountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!window.confirm(`Unlink the ${provider} account from this identity?`)) return;
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/unlink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, providerAccountId }),
    });
    setBusy(false);
    if (res.ok) router.refresh(); else setFailed(true);
  }
  return (
    <button onClick={go} disabled={busy}
      className={dangerBtn + " border-default-300 text-default-500"}>
      {busy ? "…" : "Unlink"}{failed ? " ✕" : ""}
    </button>
  );
}

export function DeleteIdentityAction({ userId, displayName }: { userId: string; displayName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { setOpen(false); router.refresh(); } else setFailed(true);
  }
  if (!open) {
    return <button onClick={() => setOpen(true)} className={dangerBtn + " border-danger text-danger"}>Hard delete…</button>;
  }
  return (
    <div className="rounded-lg border border-danger/50 bg-danger/5 p-3 space-y-2">
      <p className="text-[13px] text-danger">Type <code className="font-mono">{displayName}</code> to permanently delete this identity (run.auth only — run.human/bib are not touched).</p>
      <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
        className="w-full rounded-md border border-default-300 bg-content1 px-2 py-1 text-sm" placeholder={displayName} />
      <div className="flex gap-2">
        <button disabled={busy || confirmText !== displayName} onClick={go}
          className={dangerBtn + " border-danger text-danger"}>{busy ? "Deleting…" : "Delete permanently"}</button>
        <button onClick={() => { setOpen(false); setConfirmText(""); }} className={dangerBtn + " border-default-300 text-default-500"}>Cancel</button>
      </div>
      {failed && <p className="text-[12px] text-danger">Delete failed — try again.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write `AdminConsole.tsx`**

`apps/run.auth/webapp/src/app/admin/AdminConsole.tsx`:
```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import type { IdentityRow, IdentitySort, SummaryTiles, ProviderKey } from "@/lib/identity-report";
import { LockAction, UnlinkAction, DeleteIdentityAction } from "./AdminActions";

type Row = Omit<IdentityRow, "emailFull">;
type RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null };
type Detail = {
  identity: { userId: string; displayName: string; email: string | null; services: string[];
    lastProvider: string | null; createdAt: number | null; lockedOut: boolean;
    lockoutReason: string | null; sessionVersion: number };
  accounts: { provider: string; providerAccountId: string; userId: string }[];
  oidcSessions: { id: string; expiresAt: number | null }[];
  runHuman: RunHumanRef;
};

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  github: "GH", discord: "DC", linkedin: "IN", strava: "ST", email: "EM",
};

function Chip({ p, on }: { p: ProviderKey; on: boolean }) {
  return (
    <span title={p} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold mr-1 ${
      on ? "bg-primary/15 text-primary" : "bg-default-100 text-default-300"}`}>
      {PROVIDER_LABEL[p]}
    </span>
  );
}

const ALL_PROVIDERS: ProviderKey[] = ["github", "discord", "linkedin", "strava", "email"];

export default function AdminConsole({ initialRows, tiles, adminEmail }: {
  initialRows: Row[]; tiles: SummaryTiles; adminEmail: string | null;
}) {
  const [rows] = useState<Row[]>(initialRows);
  const [q, setQ] = useState("");
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<IdentitySort>("created");
  const [pill, setPill] = useState<null | "multi" | "locked" | "new24h" | "notRunHuman">(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [refs, setRefs] = useState<Record<string, RunHumanRef>>({});
  const [drawer, setDrawer] = useState<Detail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Server-side email search (debounced). Returns userIds only.
  useEffect(() => {
    if (!q.trim()) { setMatchedIds(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/identities?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Row[] };
      setMatchedIds(new Set(data.rows.map((r) => r.userId)));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    let out = [...rows];
    if (matchedIds) out = out.filter((r) => matchedIds.has(r.userId));
    if (pill === "multi") out = out.filter((r) => r.providerCount > 1);
    if (pill === "locked") out = out.filter((r) => r.lockedOut);
    if (pill === "new24h") {
      const cut = Date.now() - 24 * 3600 * 1000;
      out = out.filter((r) => r.createdAt != null && r.createdAt >= cut);
    }
    if (pill === "notRunHuman") out = out.filter((r) => refs[r.userId] && !refs[r.userId].found);
    const cmp: Record<IdentitySort, (a: Row, b: Row) => number> = {
      created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      providers: (a, b) => b.providerCount - a.providerCount,
      displayName: (a, b) => a.displayName.localeCompare(b.displayName),
    };
    return out.sort(cmp[sort]);
  }, [rows, matchedIds, pill, sort, refs]);

  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);

  // Lazily resolve run.human for the visible page.
  useEffect(() => {
    const need = pageRows.map((r) => r.userId).filter((id) => !(id in refs));
    if (need.length === 0) return;
    (async () => {
      const res = await fetch(`/api/admin/identities/resolve-runhuman`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: need }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { refs: Record<string, RunHumanRef> };
      setRefs((prev) => ({ ...prev, ...data.refs }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, filtered.length, sort, pill, matchedIds]);

  async function openDrawer(userId: string) {
    setDrawerLoading(true); setDrawer(null);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}`, { cache: "no-store" });
    setDrawerLoading(false);
    if (res.ok) setDrawer((await res.json()) as Detail);
  }

  const csvHref = `/api/admin/identities?format=csv&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-museo text-2xl font-bold">defcon.run 34 · Auth Identity Admin<span className="text-primary">.</span></h1>
        <span className="text-default-400 text-sm">signed in as {adminEmail}</span>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Identities", tiles.totalIdentities], ["New 24h", tiles.new24h],
           ["Multi-provider", tiles.multiProvider], ["Locked", tiles.locked]] as const).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-divider bg-content1 p-4">
            <div className="text-default-400 text-xs uppercase tracking-wide">{label}</div>
            <div className="text-2xl font-bold">{n}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="search full email…"
          className="rounded-md border border-default-300 bg-content1 px-3 py-1.5 text-sm" />
        {([["multi", "multi-provider"], ["locked", "locked"], ["new24h", "created <24h"], ["notRunHuman", "not in run.human"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setPill(pill === key ? null : key); setPage(0); }}
            className={`rounded-full px-3 py-1 text-xs border ${pill === key ? "bg-primary/15 border-primary text-primary" : "border-default-300 text-default-500"}`}>
            {label}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as IdentitySort)}
          className="rounded-md border border-default-300 bg-content1 px-2 py-1.5 text-sm">
          <option value="created">newest</option>
          <option value="providers">most providers</option>
          <option value="displayName">name A–Z</option>
        </select>
        <a href={csvHref} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Download CSV</a>
      </div>

      <div className="overflow-x-auto rounded-xl border border-divider">
        <table className="w-full text-sm">
          <thead className="bg-content2 text-left text-default-500">
            <tr>
              <th className="px-3 py-2">rabbit</th><th className="px-3 py-2">email</th>
              <th className="px-3 py-2">providers</th><th className="px-3 py-2">last</th>
              <th className="px-3 py-2">created</th><th className="px-3 py-2">run.human</th>
              <th className="px-3 py-2">groups</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const rh = refs[r.userId];
              return (
                <tr key={r.userId} className="border-t border-divider hover:bg-content2/40 cursor-pointer" onClick={() => openDrawer(r.userId)}>
                  <td className="px-3 py-2 font-medium">{r.displayName}{r.lockedOut && <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">LOCKED</span>}</td>
                  <td className="px-3 py-2"><span className="blur-[3px] hover:blur-none transition">{r.emailMasked}</span></td>
                  <td className="px-3 py-2">{ALL_PROVIDERS.map((p) => <Chip key={p} p={p} on={r.providers.includes(p)} />)}</td>
                  <td className="px-3 py-2 text-default-400">{r.lastProvider ?? "—"}</td>
                  <td className="px-3 py-2 text-default-400">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2">{rh == null ? <span className="text-default-300">…</span> : rh.found ? <span className="text-success" title={rh.runUserId ?? ""}>✓ {rh.displayName}</span> : <span className="text-danger">✗</span>}</td>
                  <td className="px-3 py-2 text-default-400">{r.services.join(", ")}</td>
                  <td className="px-3 py-2 text-primary">open →</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm text-default-500">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">← prev</button>
        <span>page {page + 1} / {Math.max(1, Math.ceil(filtered.length / perPage))} · {filtered.length} rows</span>
        <button disabled={(page + 1) * perPage >= filtered.length} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">next →</button>
        <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }} className="ml-auto rounded-md border border-default-300 bg-content1 px-2 py-1">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>

      {(drawer || drawerLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => { setDrawer(null); setDrawerLoading(false); }}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-content1 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {drawerLoading && <p className="text-default-400">Loading…</p>}
            {drawer && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">{drawer.identity.displayName}</h2>
                  <button onClick={() => setDrawer(null)} className="text-default-400">✕</button>
                </div>
                <div className="text-sm"><span className="text-default-400">email:</span> {drawer.identity.email ?? "—"}</div>
                <div className="text-sm"><span className="text-default-400">sub / userId:</span> <code className="font-mono text-xs">{drawer.identity.userId}</code></div>
                <div className="text-sm"><span className="text-default-400">run.human:</span> {drawer.runHuman.found ? `✓ ${drawer.runHuman.displayName} (${drawer.runHuman.runUserId})` : "✗ not found"}</div>
                <div className="text-sm"><span className="text-default-400">groups:</span> {drawer.identity.services.join(", ") || "—"}</div>
                <div className="text-sm"><span className="text-default-400">sessionVersion:</span> {drawer.identity.sessionVersion}{drawer.identity.lockedOut && <span className="ml-2 text-warning">LOCKED · {drawer.identity.lockoutReason}</span>}</div>

                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-default-400">linked accounts</h3>
                  {drawer.accounts.length === 0 && <p className="text-sm text-default-400">none</p>}
                  {drawer.accounts.map((a) => (
                    <div key={`${a.provider}#${a.providerAccountId}`} className="mb-2 flex items-center justify-between rounded-md border border-divider p-2 text-sm">
                      <span>{a.provider} · <code className="font-mono text-xs">{a.providerAccountId}</code></span>
                      <UnlinkAction userId={drawer.identity.userId} provider={a.provider} providerAccountId={a.providerAccountId} />
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-default-400">live SSO sessions</h3>
                  {drawer.oidcSessions.length === 0 && <p className="text-sm text-default-400">none</p>}
                  {drawer.oidcSessions.map((s) => (
                    <div key={s.id} className="text-xs text-default-500">…{s.id.slice(-8)} · expires {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "—"}</div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-divider pt-3">
                  <LockAction userId={drawer.identity.userId} locked={drawer.identity.lockedOut} />
                  <DeleteIdentityAction userId={drawer.identity.userId} displayName={drawer.identity.displayName} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build the app (compile gate for the whole surface)**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit && npm run build`
Expected: type-check clean; build succeeds. Fix any HeroUI token / import issues surfaced here.

- [ ] **Step 4: Commit**

```bash
git add apps/run.auth/webapp/src/app/admin/AdminConsole.tsx apps/run.auth/webapp/src/app/admin/AdminActions.tsx
git commit -m "feat(auth-admin): interactive identity console + drawer + destructive actions"
```

---

## Task 12: End-to-end verification (local)

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd apps/run.auth/webapp && nvm use 23.6.0 && npx vitest run`
Expected: all suites pass, including the four new test files.

- [ ] **Step 2: Type-check + build**

Run: `cd apps/run.auth/webapp && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Gate proof (signed-out)**

With the dev server running: `curl -i http://localhost:3002/admin` and `curl -i http://localhost:3002/api/admin/identities`
Expected: **404** for both (non-disclosure).

- [ ] **Step 4: Signed-in admin smoke (manual, against local dynamo or staging)**

As a signed-in admin: load `/admin`, confirm the table renders, provider chips reflect linked accounts, a row's drawer opens with full email + accounts + run.human resolve, and Lock → confirms → row shows `LOCKED`. Unlink removes an account row. Hard-delete requires typing the rabbit name and removes the identity. Use the **verify** skill to drive this in the real app rather than asserting from code.

- [ ] **Step 5: Commit any fixes, then push**

```bash
git add -A && git commit -m "test(auth-admin): green e2e — suite, build, gate proof" --allow-empty
git pull --rebase && git push -u origin gsd/auth-identity-admin-dashboard
git status   # MUST show up-to-date with origin
```

---

## Self-Review Notes (author)

- **Spec coverage:** identity-first table (Task 2/10/11), provider truth incl. LinkedIn from ACCOUNT rows (Task 3 `scanAllAccounts` + Task 2 `deriveProviders`), live run.human join (Tasks 4/5/7/8/11), masked search + CSV (Task 6), lockout (Task 9), unlink (Task 9), run.auth-only hard delete (Tasks 3/8/11), 404 non-disclosure gate everywhere (Task 1 + every route), in-process revalidation (Task 1). Cascade delete + Altcha-on-OAuth + IP capture explicitly OUT (spec §Out of Scope) — no tasks, by design.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `IdentityRow`/`ProfileRow`/`AccountRow`/`ProviderKey`/`RunHumanRef`/`SummaryTiles` defined in Tasks 2/4 and consumed unchanged in Tasks 3/6/8/10/11. `revalidateAdmin(userId)` uses `session.user.id` (run.auth's single id namespace) consistently.
- **Known verification points flagged inline:** ElectroDB `scan.go` cursor shape (Task 3) and the `auth` session-helper export name (Task 6) must be checked against existing run.auth call sites before relying on them — notes included at those tasks.
```
