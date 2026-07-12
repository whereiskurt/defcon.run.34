# Bib name → rabbit name sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate a saved run.bib `nameOnBib` to the runner's run.human rabbit name (`displayName`), continuing to sync on every bib save until the runner edits the rabbit name manually with the profile pencil — after which the rabbit name is manual-only.

**Architecture:** One-way, best-effort, server-to-server. run.human gains a `displayNameManual` marker on `RunUser`, a pure lock/normalize lib, and a secret-gated `PATCH /api/internal/user/[oidcSub]` write path; the profile pencil stamps the marker. run.bib gains a `rabbit-name-sync` lib and fires it (fail-open) from `PATCH /api/bib` after a name save.

**Tech Stack:** Next.js 16 / React 19, TypeScript, ElectroDB + DynamoDB, Zod, Vitest. Two separate deployables (run.human, run.bib) with no shared package — the tiny normalize/lock helpers are duplicated per app, matching this monorepo's established pattern.

## Global Constraints

- **Node for tests:** `nvm use 23.6.0` before running vitest in either app (default v22.1.0 fails to start — environmental, not a test failure).
- **Rabbit name (`displayName`) rules:** 3–20 chars, trimmed. Do not change these rules.
- **Bib name (`nameOnBib`) rules:** 0–24 chars, non-printable-ASCII stripped. Do not change these.
- **Auto-default name:** `rabbit_${adapterUserId.slice(0, 4)}` — the exact string `upsertRunUser` generates. The lock heuristic compares against this verbatim.
- **Internal call auth:** header `X-Internal-Secret` must equal `config.auth.internalSecret` (run.human) / `process.env.AUTH_INTERNAL_SECRET` (run.bib). Never log the secret.
- **Fail-open:** a sync failure must NEVER block or fail the bib save, and must never throw out of the bib PATCH path.
- **No quota:** the internal sync write must NOT consume run.human's `displayname_change` quota.
- **Namespace:** run.bib passes the OIDC `sub` (`session.user.id` in bib). run.human resolves sub → adapter userId via the authjs accounts GSI1 lookup, exactly as the existing GET does.

---

### Task 1: run.human — `displayNameManual` marker + pure lock/normalize lib

**Files:**
- Modify: `apps/run.human/webapp/src/entities/run-user.ts` (add attribute ~line 37; extend `RunUserItem` type ~line 342; extend `updateRunUserProfile` data type ~line 280)
- Create: `apps/run.human/webapp/src/lib/rabbit-name-sync.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/rabbit-name-sync.test.ts`

**Interfaces:**
- Produces:
  - `autoDefaultName(adapterUserId: string): string`
  - `isDisplayNameLocked(currentDisplayName: string | undefined, displayNameManual: boolean | undefined, adapterUserId: string): boolean`
  - `normalizeSyncedName(raw: string): string | null` — trimmed, `null` when < 3 chars, else clamped to 20.
  - `RunUser` entity + `RunUserItem` now carry optional `displayNameManual: boolean`.
  - `updateRunUserProfile` data param accepts optional `displayNameManual?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/run.human/webapp/src/lib/__tests__/rabbit-name-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  autoDefaultName,
  isDisplayNameLocked,
  normalizeSyncedName,
} from "@/lib/rabbit-name-sync";

describe("autoDefaultName", () => {
  it("mirrors upsertRunUser: rabbit_ + first 4 chars of the adapter id", () => {
    expect(autoDefaultName("abcd1234-5678")).toBe("rabbit_abcd");
  });
});

describe("normalizeSyncedName", () => {
  it("returns null for empty / whitespace / 1-2 chars", () => {
    expect(normalizeSyncedName("")).toBeNull();
    expect(normalizeSyncedName("   ")).toBeNull();
    expect(normalizeSyncedName("ab")).toBeNull();
    expect(normalizeSyncedName("  x ")).toBeNull();
  });
  it("trims and passes 3-20 char names verbatim", () => {
    expect(normalizeSyncedName("  OGRE ")).toBe("OGRE");
    expect(normalizeSyncedName("12345678901234567890")).toBe(
      "12345678901234567890"
    );
  });
  it("truncates > 20 chars to the first 20 (after trim)", () => {
    expect(normalizeSyncedName("abcdefghijklmnopqrstuvwx")).toBe(
      "abcdefghijklmnopqrst"
    );
  });
});

describe("isDisplayNameLocked", () => {
  const uid = "abcd1234";
  it("locked when the manual flag is explicitly true", () => {
    expect(isDisplayNameLocked("anything", true, uid)).toBe(true);
  });
  it("unlocked when the manual flag is explicitly false", () => {
    expect(isDisplayNameLocked("PrevBibName", false, uid)).toBe(false);
  });
  it("flag absent + still the exact auto-default => unlocked", () => {
    expect(isDisplayNameLocked("rabbit_abcd", undefined, uid)).toBe(false);
  });
  it("flag absent + name differs from the auto-default => locked", () => {
    expect(isDisplayNameLocked("KPH", undefined, uid)).toBe(true);
  });
  it("flag absent + undefined current name => unlocked (treat as default)", () => {
    // A user with no displayName at all was never manually claimed.
    expect(isDisplayNameLocked(undefined, undefined, uid)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/run.human/webapp`): `nvm use 23.6.0 && npx vitest run src/lib/__tests__/rabbit-name-sync.test.ts`
Expected: FAIL — cannot resolve `@/lib/rabbit-name-sync`.

- [ ] **Step 3: Create the pure lib**

Create `apps/run.human/webapp/src/lib/rabbit-name-sync.ts`:

```ts
/**
 * Pure helpers for the bib-name -> rabbit-name (displayName) sync.
 *
 * Kept dependency-free so the lock policy and length reconciliation are unit
 * testable in isolation. The internal PATCH route composes these; see
 * docs/superpowers/specs/2026-07-11-bib-name-rabbit-sync-design.md.
 */

export const DISPLAYNAME_MIN = 3;
export const DISPLAYNAME_MAX = 20;

/** The exact displayName upsertRunUser() generates for a brand-new user. */
export function autoDefaultName(adapterUserId: string): string {
  return `rabbit_${adapterUserId.slice(0, 4)}`;
}

/**
 * True when the sync must NOT overwrite the rabbit name.
 *
 * - manual flag true  -> locked (runner claimed it with the pencil).
 * - manual flag false -> unlocked (a prior sync stamped it; keep saving over).
 * - flag absent (pre-feature users): locked unless the name is still the exact
 *   auto-default, since nothing had ever bib-synced before this shipped, so any
 *   non-default name was chosen deliberately.
 */
export function isDisplayNameLocked(
  currentDisplayName: string | undefined,
  displayNameManual: boolean | undefined,
  adapterUserId: string
): boolean {
  if (displayNameManual === true) return true;
  if (displayNameManual === false) return false;
  // Flag absent: locked only if a non-empty name differs from the auto-default.
  // An empty/undefined name was never claimed, so treat it as unlocked.
  const current = currentDisplayName ?? "";
  return current !== "" && current !== autoDefaultName(adapterUserId);
}

/**
 * Reconcile an incoming bib name to run.human's 3-20 rules.
 * Returns null when it can't be a valid rabbit name (< 3 chars after trim),
 * else the trimmed name clamped to 20 chars.
 */
export function normalizeSyncedName(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < DISPLAYNAME_MIN) return null;
  return trimmed.slice(0, DISPLAYNAME_MAX);
}
```

Note on `isDisplayNameLocked`: an absent flag with an empty/undefined current name is treated as *unlocked* (a user who never had a displayName was never manually claimed), matching the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/rabbit-name-sync.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add `displayNameManual` to the entity + types**

In `apps/run.human/webapp/src/entities/run-user.ts`, add the attribute right after the `displayName` attribute block (after line 37):

```ts
      // Set true once the runner edits their display name with the profile
      // pencil. The bib-name sync refuses to overwrite a manually-claimed name
      // and stamps this false on each of its own writes. See lib/rabbit-name-sync.
      displayNameManual: {
        type: "boolean",
      },
```

In the `updateRunUserProfile` data parameter type (~line 280), add the field:

```ts
  data: {
    displayName?: string;
    displayNameManual?: boolean;
    bio?: string;
    preferences?: {
      theme?: string;
      units?: string;
      privacyLevel?: string;
      checkinPreference?: string;
    };
  }
```

In the `RunUserItem` type (~line 342), add after `displayName?`:

```ts
  displayName?: string;
  displayNameManual?: boolean;
```

- [ ] **Step 6: Verify the entity change typechecks**

Run (from `apps/run.human/webapp`): `npx tsc --noEmit`
Expected: no new errors from `run-user.ts` (pre-existing unrelated errors, if any, are out of scope — confirm none reference `displayNameManual`).

- [ ] **Step 7: Commit**

```bash
git add apps/run.human/webapp/src/lib/rabbit-name-sync.ts \
        apps/run.human/webapp/src/lib/__tests__/rabbit-name-sync.test.ts \
        apps/run.human/webapp/src/entities/run-user.ts
git commit -m "feat(human): displayNameManual marker + pure rabbit-name lock/normalize lib"
```

---

### Task 2: run.human — secret-gated `PATCH /api/internal/user/[oidcSub]` write path

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` (extract `resolveAdapterUserId`; add `PATCH`)
- Test: `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `isDisplayNameLocked`, `normalizeSyncedName` (Task 1); `getRunUser`, `updateRunUserProfile` (`@/entities/run-user`); `dynamodbClient`, `DYNAMODB_TABLE` (`@/entities/client`); `config` (`@/config`).
- Produces: `PATCH(req, { params })` returning `{ synced: boolean, ... }`. Never consumes quota.

- [ ] **Step 1: Write the failing test**

Create `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockGet = vi.fn();
const mockGetRunUser = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/entities/client", () => ({
  dynamodbClient: {
    query: (...a: unknown[]) => mockQuery(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
  DYNAMODB_TABLE: "test-table",
}));
vi.mock("@/entities/run-user", () => ({
  getRunUser: (...a: unknown[]) => mockGetRunUser(...a),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));

import { PATCH } from "../route";
import type { NextRequest } from "next/server";

function req(
  secret: string | null,
  body: unknown,
  oidcSub = "oidc-1"
): { request: NextRequest; params: Promise<{ oidcSub: string }> } {
  return {
    request: {
      headers: { get: (k: string) => (k === "x-internal-secret" ? secret : null) },
      json: async () => body,
    } as unknown as NextRequest,
    params: Promise.resolve({ oidcSub }),
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGet.mockReset();
  mockGetRunUser.mockReset();
  mockUpdate.mockReset();
  // Default: account lookup resolves to adapter user "adapter-abcd1234".
  mockQuery.mockResolvedValue({ Items: [{ userId: "adapter-abcd1234" }] });
});

describe("PATCH /api/internal/user/[oidcSub]", () => {
  it("403s without the internal secret", async () => {
    const { request, params } = req(null, { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s when no account maps to the OIDC sub", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips (synced:false) a too-short name without touching the user", async () => {
    const { request, params } = req("s3cret", { displayName: "ab" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ synced: false, reason: "too_short" });
    expect(mockGetRunUser).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips (synced:false, manual) when displayNameManual is true", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "ChosenName",
      displayNameManual: true,
    });
    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: false, reason: "manual" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips (manual) by heuristic when flag absent and name is non-default", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "KPH", // != rabbit_abcd
    });
    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: false, reason: "manual" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("overwrites (synced:true) an unclaimed default name and stamps manual:false", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "rabbit_abcd", // exact auto-default
    });
    mockUpdate.mockResolvedValue(undefined);
    const { request, params } = req("s3cret", { displayName: "  OGRE  " });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: true, displayName: "OGRE" });
    expect(mockUpdate).toHaveBeenCalledWith("adapter-abcd1234", {
      displayName: "OGRE",
      displayNameManual: false,
    });
  });

  it("truncates a > 20 char name before writing", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "rabbit_abcd",
      displayNameManual: false,
    });
    mockUpdate.mockResolvedValue(undefined);
    const { request, params } = req("s3cret", {
      displayName: "abcdefghijklmnopqrstuvwx",
    });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body.displayName).toBe("abcdefghijklmnopqrst");
    expect(mockUpdate).toHaveBeenCalledWith("adapter-abcd1234", {
      displayName: "abcdefghijklmnopqrst",
      displayNameManual: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/run.human/webapp`): `nvm use 23.6.0 && npx vitest run "src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts"`
Expected: FAIL — `PATCH` is not exported from `../route`.

- [ ] **Step 3: Extract the account resolver and add PATCH**

In `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts`:

Add imports at the top (after the existing imports):

```ts
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import {
  isDisplayNameLocked,
  normalizeSyncedName,
} from "@/lib/rabbit-name-sync";
```

(Note: `getRunUser` is already imported — merge, do not duplicate. Keep `updateRunUserProfile` added.)

Add a shared resolver helper below the `OIDC_PROVIDER` constant:

```ts
/**
 * Resolve an OIDC subject to its Auth.js adapter userId via the accounts GSI1.
 * Returns null when no account maps to the subject.
 */
async function resolveAdapterUserId(oidcSub: string): Promise<string | null> {
  const accountResult = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: {
      ":gsi1pk": `ACCOUNT#${OIDC_PROVIDER}`,
      ":gsi1sk": `ACCOUNT#${oidcSub}`,
    },
  });
  const account = accountResult.Items?.[0];
  const adapterUserId = account?.userId as string | undefined;
  return adapterUserId ?? null;
}
```

Refactor the GET handler to use it — replace the inline query block (the `dynamodbClient.query({...})` call and the `account` / `adapterUserId` derivation, roughly lines 35–64) with:

```ts
    const adapterUserId = await resolveAdapterUserId(oidcSub);
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "No account found for OIDC subject" },
        { status: 404 }
      );
    }
```

Leave the rest of GET (the `getRunUser`, email lookup, and response) unchanged.

Append the PATCH handler at the end of the file:

```ts
/**
 * Internal API: overwrite a runner's rabbit name (displayName) from run.bib.
 *
 * Secret-gated, server-to-server only. Fires when the runner saves their bib
 * name. Refuses to overwrite a manually-claimed name (see isDisplayNameLocked)
 * and never consumes the displayname_change quota — this is an internal sync,
 * not a user-initiated change. Idempotent and safe to call on every bib save.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ oidcSub: string }> }
) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { oidcSub } = await params;
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  let body: { displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rawName = typeof body.displayName === "string" ? body.displayName : "";
  const name = normalizeSyncedName(rawName);
  if (!name) {
    // Too short / empty — nothing to sync, leave the rabbit name as-is.
    return NextResponse.json({ synced: false, reason: "too_short" });
  }

  try {
    const adapterUserId = await resolveAdapterUserId(oidcSub);
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "No account found for OIDC subject" },
        { status: 404 }
      );
    }

    const user = await getRunUser(adapterUserId);
    if (!user) {
      return NextResponse.json({ error: "RunUser not found" }, { status: 404 });
    }

    if (isDisplayNameLocked(user.displayName, user.displayNameManual, adapterUserId)) {
      return NextResponse.json({ synced: false, reason: "manual" });
    }

    await updateRunUserProfile(adapterUserId, {
      displayName: name,
      displayNameManual: false,
    });
    return NextResponse.json({ synced: true, displayName: name });
  } catch (error) {
    console.error("[run.human] PATCH /api/internal/user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts"`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from the route file.

- [ ] **Step 6: Commit**

```bash
git add "apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts" \
        "apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/__tests__/route.test.ts"
git commit -m "feat(human): internal PATCH to sync rabbit name from bib (secret-gated, quota-free, respects manual claim)"
```

---

### Task 3: run.human — profile pencil stamps `displayNameManual: true`

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/user/route.ts` (the `displayName` branch of `PATCH`, ~line 148)
- Test: `apps/run.human/webapp/src/app/api/user/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `updateRunUserProfile` (now accepts `displayNameManual`, Task 1).
- Produces: a manual displayName edit persists `displayNameManual: true`.

- [ ] **Step 1: Write the failing test**

Create `apps/run.human/webapp/src/app/api/user/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockUpdate = vi.fn();
const mockRequireQuota = vi.fn();

vi.mock("@auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/entities/run-user", () => ({
  getRunUser: vi.fn(),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
vi.mock("@/entities/bib", () => ({ getRunnerCode: vi.fn() }));
vi.mock("@/lib/pin-icons", () => ({
  pinIconById: vi.fn(),
  canUsePinIcon: vi.fn(() => true),
  isValidPinColor: vi.fn(() => true),
}));
vi.mock("@/lib/quota-client", () => ({
  getUserQuotas: vi.fn(),
  getQuotaDefinitions: vi.fn(),
  requireAndConsumeQuota: (...a: unknown[]) => mockRequireQuota(...a),
  isQuotaExceededError: () => false,
}));

import { PATCH } from "../route";
import type { NextRequest } from "next/server";

function patch(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockUpdate.mockReset();
  mockRequireQuota.mockReset();
  mockAuth.mockResolvedValue({ user: { id: "adapter-1" } });
  mockRequireQuota.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
});

describe("PATCH /api/user displayName", () => {
  it("stamps displayNameManual:true when the runner edits their name", async () => {
    const res = await PATCH(patch({ displayName: "KurtRuns" }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("adapter-1", {
      displayName: "KurtRuns",
      displayNameManual: true,
    });
  });

  it("still enforces the 3-20 length rule (400, no write)", async () => {
    const res = await PATCH(patch({ displayName: "ab" }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/run.human/webapp`): `nvm use 23.6.0 && npx vitest run "src/app/api/user/__tests__/route.test.ts"`
Expected: FAIL — the first case: `updateRunUserProfile` called with `{ displayName: "KurtRuns" }` (no `displayNameManual`).

- [ ] **Step 3: Stamp the marker**

In `apps/run.human/webapp/src/app/api/user/route.ts`, change the write in the `displayName` branch (currently `await updateRunUserProfile(session.user.id, { displayName: trimmed });`) to:

```ts
      // A manual pencil edit claims the rabbit name: mark it so the bib-name
      // sync stops overwriting it (docs/.../bib-name-rabbit-sync-design.md).
      await updateRunUserProfile(session.user.id, {
        displayName: trimmed,
        displayNameManual: true,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/user/__tests__/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/app/api/user/route.ts \
        "apps/run.human/webapp/src/app/api/user/__tests__/route.test.ts"
git commit -m "feat(human): profile pencil stamps displayNameManual so bib sync stops overwriting"
```

---

### Task 4: run.bib — rabbit-name sync lib (normalize + fetch + best-effort orchestrator)

**Files:**
- Create: `apps/run.bib/webapp/src/lib/rabbit-name-sync.ts`
- Test: `apps/run.bib/webapp/src/__tests__/rabbit-name-sync.test.ts`

**Interfaces:**
- Consumes: env `RUN_HUMAN_INTERNAL_URL`, `AUTH_INTERNAL_SECRET`, `REGION_SHORT`, `SITE_DOMAIN`, `LOCAL_HUMAN_PORT` (same derivation as `lib/social-qr.ts`); global `fetch`.
- Produces:
  - `normalizeSyncedName(raw: string): string | null`
  - `syncRabbitName(ownerSub: string, name: string): Promise<boolean>` — `PATCH`es the run.human internal endpoint; returns `res.ok`; never throws.
  - `maybeSyncRabbitName(ownerSub: string, rawName: string): Promise<"synced" | "skipped" | "failed">` — normalize + guard + best-effort call; never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/run.bib/webapp/src/__tests__/rabbit-name-sync.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSyncedName,
  syncRabbitName,
  maybeSyncRabbitName,
} from "@/lib/rabbit-name-sync";

describe("normalizeSyncedName", () => {
  it("nulls empty / 1-2 char names, trims, and truncates to 20", () => {
    expect(normalizeSyncedName("")).toBeNull();
    expect(normalizeSyncedName("ab")).toBeNull();
    expect(normalizeSyncedName("  OGRE ")).toBe("OGRE");
    expect(normalizeSyncedName("abcdefghijklmnopqrstuvwx")).toBe(
      "abcdefghijklmnopqrst"
    );
  });
});

describe("syncRabbitName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("PATCHes the internal endpoint and returns true on ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncRabbitName("sub-1", "OGRE")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/internal/user/sub-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ displayName: "OGRE" });
    expect(init.headers["X-Internal-Secret"]).toBeDefined();
  });

  it("returns false on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(syncRabbitName("sub-2", "OGRE")).resolves.toBe(false);
  });

  it("returns false (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(syncRabbitName("sub-3", "OGRE")).resolves.toBe(false);
  });
});

describe("maybeSyncRabbitName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips a too-short name without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(maybeSyncRabbitName("sub-1", "ab")).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates then syncs a long name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      maybeSyncRabbitName("sub-1", "abcdefghijklmnopqrstuvwx")
    ).resolves.toBe("synced");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      displayName: "abcdefghijklmnopqrst",
    });
  });

  it("returns 'failed' (never throws) when the sync errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(maybeSyncRabbitName("sub-1", "OGRE")).resolves.toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/run.bib/webapp`): `nvm use 23.6.0 && npx vitest run src/__tests__/rabbit-name-sync.test.ts`
Expected: FAIL — cannot resolve `@/lib/rabbit-name-sync`.

- [ ] **Step 3: Create the lib**

Create `apps/run.bib/webapp/src/lib/rabbit-name-sync.ts`:

```ts
/**
 * Bib-name -> rabbit-name sync (run.bib caller side).
 *
 * When a runner saves their bib name we best-effort propagate it to their
 * run.human rabbit name (displayName) via the secret-gated internal PATCH
 * endpoint. Fail-open: nothing here may ever throw into or fail the bib save.
 *
 * The internal-URL + X-Internal-Secret derivation mirrors lib/social-qr.ts (the
 * RUN_HUMAN_INTERNAL_URL fallback host + basePath=/{region} in prod). See
 * docs/superpowers/specs/2026-07-11-bib-name-rabbit-sync-design.md.
 */

const DISPLAYNAME_MIN = 3;
const DISPLAYNAME_MAX = 20;

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_HUMAN_PORT = process.env.LOCAL_HUMAN_PORT || "3001";

const HUMAN_BASE_URL =
  process.env.RUN_HUMAN_INTERNAL_URL ||
  (isDev
    ? `http://localhost:${LOCAL_HUMAN_PORT}`
    : `http://run-human.app-${region}-${siteDomain.replace(
        /\./g,
        "-"
      )}.local:3000/${region}`);

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || "";

/**
 * Reconcile a bib name to run.human's 3-20 rabbit-name rules.
 * Returns null when it can't be synced (< 3 chars after trim), else the trimmed
 * name clamped to 20 chars.
 */
export function normalizeSyncedName(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < DISPLAYNAME_MIN) return null;
  return trimmed.slice(0, DISPLAYNAME_MAX);
}

/**
 * PATCH the run.human internal endpoint to set the runner's displayName.
 * Returns res.ok; resolves false (never throws) on any failure — the bib save
 * must never be affected by a sync miss.
 */
export async function syncRabbitName(
  ownerSub: string,
  name: string
): Promise<boolean> {
  try {
    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(
      ownerSub
    )}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ displayName: name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Normalize + guard + best-effort sync. Never throws.
 * - "skipped": name too short to be a valid rabbit name (nothing sent).
 * - "synced":  run.human accepted the write (2xx).
 * - "failed":  a valid name was sent but the call failed/non-2xx.
 * (Note: run.human still independently refuses manually-claimed names; a
 * "synced" here means the endpoint returned 2xx, which includes its own
 * {synced:false,reason:"manual"} no-op — that is the correct, safe outcome.)
 */
export async function maybeSyncRabbitName(
  ownerSub: string,
  rawName: string
): Promise<"synced" | "skipped" | "failed"> {
  const name = normalizeSyncedName(rawName);
  if (!name) return "skipped";
  try {
    return (await syncRabbitName(ownerSub, name)) ? "synced" : "failed";
  } catch {
    return "failed";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/rabbit-name-sync.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/lib/rabbit-name-sync.ts \
        apps/run.bib/webapp/src/__tests__/rabbit-name-sync.test.ts
git commit -m "feat(bib): rabbit-name sync lib (normalize + secret-gated PATCH + fail-open orchestrator)"
```

---

### Task 5: run.bib — fire the sync from `PATCH /api/bib` after a name save

**Files:**
- Modify: `apps/run.bib/webapp/src/app/api/bib/route.ts` (import + inside the `nameOnBib` branch, ~line 228)

**Interfaces:**
- Consumes: `maybeSyncRabbitName` (Task 4).

- [ ] **Step 1: Add the import**

At the top of `apps/run.bib/webapp/src/app/api/bib/route.ts`, add:

```ts
import { maybeSyncRabbitName } from "@/lib/rabbit-name-sync";
```

- [ ] **Step 2: Fire the best-effort sync after the name write**

In the `PATCH` handler, in the `if (parsed.data.nameOnBib !== undefined)` block, immediately after `bib = await updateBibName(session.user.id, parsed.data.nameOnBib);` (line ~228), add:

```ts
      // Best-effort: propagate the saved bib name to the runner's run.human
      // rabbit name (displayName), until they've claimed it manually with the
      // profile pencil. maybeSyncRabbitName never throws and its result is
      // intentionally ignored — a sync miss must never fail the bib save.
      // (Awaited so the ECS Node runtime completes it before the response.)
      await maybeSyncRabbitName(session.user.id, parsed.data.nameOnBib);
```

- [ ] **Step 3: Typecheck**

Run (from `apps/run.bib/webapp`): `nvm use 23.6.0 && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Run the full bib test suite (regression)**

Run: `npx vitest run`
Expected: PASS — all pre-existing tests plus the new `rabbit-name-sync` tests. (The wiring behavior itself is covered by Task 4's `maybeSyncRabbitName` tests; this step guards against regressions in the route.)

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/bib/route.ts
git commit -m "feat(bib): sync saved bib name to run.human rabbit name on PATCH /api/bib"
```

---

## Post-implementation: build + publish + deploy

After all five tasks pass and the branch is pushed + PR opened/approved:

- [ ] **Version bump + release** both apps (run.human and run.bib) via the repo's release flow (`apps/release-all.sh` / the GH Actions buildpub → deploy.yml recipe). Both apps changed, so both get a version bump + image build/push to ECR + ECS deploy to `us-east-1` (use1).
- [ ] **Set env parity:** confirm `RUN_HUMAN_INTERNAL_URL` and `AUTH_INTERNAL_SECRET` are already present on the run.bib ECS task (they are — `social-qr.ts` uses the same two, and bib QRs work in prod), so no new secret wiring is required.
- [ ] **Smoke verify (auth-gated):** sign in on run.bib, save a bib name on `/orderform`, then confirm the run.human profile rabbit name updated; edit the rabbit name with the pencil, save a different bib name, and confirm the rabbit name is NOT overwritten. (Both surfaces are auth-gated — anonymous curl only returns the login shell; a signed-in session is required, per the orderform verify landmine.)

## Self-review notes

- **Spec coverage:** one-way sync (Task 5), sync-until-claimed marker (Tasks 1–3), length reconciliation (`normalizeSyncedName`, Tasks 1/4 + endpoint clamp Task 2), fail-open (Tasks 4/5), no-quota (Task 2 writes via `updateRunUserProfile` directly, never `requireAndConsumeQuota`), back-compat heuristic (`isDisplayNameLocked`, Task 1 + tested Task 2). All covered.
- **Type consistency:** `normalizeSyncedName`, `syncRabbitName`, `maybeSyncRabbitName`, `isDisplayNameLocked`, `autoDefaultName`, `resolveAdapterUserId`, `updateRunUserProfile({ displayName, displayNameManual })` names match across tasks.
- **No placeholders:** every code + test block is complete.
