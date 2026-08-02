# Unified Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three meanings of "route" and the four sharing mechanisms in run.gpx into one noun, one list, and one tri-state Share control — without merging the `GpxFile` / `Route` entities.

**Architecture:** `GpxFile` gains one optional `publishedRouteId` linking it to its published public face. A new `PUT /api/gpx/files/[id]/visibility` endpoint performs every share transition atomically by composing primitives that already run in production (`POST /routes {fromFileId}`, `publish`, `unpublish`, `POST /shares`, `convert-public`). Pure state logic lives in `lib/share-state.ts` so it is unit-testable; the existing `/routes/[id]/publish|unpublish` endpoints stay because orphan `Route` rows (no backing file) still use them. The Svelte UI renames "My Maps" → "My Routes", replaces `ShareDialog`'s two-verb layout with one three-state radio, and deletes the separate route-creation paths.

**Tech Stack:** Next.js 16 (App Router route handlers), ElectroDB on DynamoDB, AWS S3 (`CopyObjectCommand`), vitest 4 with `vi.hoisted` mocks, Svelte 5 (gpx-studio website), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-01-unified-routes-design.md`

## Global Constraints

- Working directory for all paths: repo root of the worktree. App root is `apps/run.gpx`.
- Webapp tests: `cd apps/run.gpx/webapp && npx vitest run <path>`. Full suite: `npm test`.
- `CloudStorage.svelte` is **legacy Svelte mode**. Introducing `$state()` there flips the file to runes and breaks its `$:` lines. Use plain `let` in that file only. `ShareDialog.svelte` and `QuickStartHub.svelte` are already runes mode — `$state()` is correct there.
- Route S3 keys are `uploads/ROUTES/{routeId}.gpx` via `getRouteKey(routeId)` and must **never** contain a user identifier — presigned URLs expose the key path.
- A `GpxFile` with `publicShareEligible: false` (raw Strava import) must never reach `Route.visibility: 'published'`. Enforced server-side, not by UI convention.
- Every mutating handler repeats the existing three gates in this order: `session?.user?.id` → 401; `services.includes("gpxstudio")` → 403; `await assertNotLockedLive(session.user.id)` → 403.
- Owner mismatch returns **404**, never 403 (non-disclosure posture used throughout run.gpx).
- Caps are in `@/lib/route-caps`: `isRouteCapped(count, isAdmin)` (50), `isPublishCapped(count, isAdmin)` (20). Admins are uncapped. Exceeded → HTTP 429.
- `Route` must keep having **no `conDay` attribute**. Do not add one. The existing schema test that locks this must stay green.
- Green is `#22c55e` via the existing `.add-run-glow` class in `Menu.svelte`. Strava orange is `#FC4C02`.
- Deploy is `us-east-1` only. Release must pass `--regions use1`.

---

### Task 1: Link field and type plumbing

**Files:**
- Modify: `apps/run.gpx/webapp/src/entities/gpx-file.ts` (attributes block, after `conDay`)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts` (`CloudFile`, `RouteSummary` interfaces)
- Test: `apps/run.gpx/webapp/src/entities/share-link.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `GpxFile` attribute `publishedRouteId?: string`. Client types `CloudFile.publishedRouteId?: string` and `RouteSummary.sourceGpxFileId?: string`.

- [ ] **Step 1: Write the failing test**

Create `apps/run.gpx/webapp/src/entities/share-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routeSchema } from "./route";

// The GpxFile schema is asserted through its raw attribute map rather than the
// live Entity, so this test needs no DynamoDB client or credentials.
import { GpxFile } from "./gpx-file";

describe("share link plumbing", () => {
  it("GpxFile carries an optional publishedRouteId", () => {
    const attrs = (GpxFile as unknown as {
      schema: { attributes: Record<string, { required?: boolean; type: string }> };
    }).schema.attributes;

    expect(attrs.publishedRouteId).toBeDefined();
    expect(attrs.publishedRouteId.type).toBe("string");
    expect(attrs.publishedRouteId.required).toBeFalsy();
  });

  it("Route still has no conDay attribute — routes stay structurally unscoreable", () => {
    expect(
      Object.keys(routeSchema.attributes)
    ).not.toContain("conDay");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/entities/share-link.test.ts`
Expected: FAIL — first test errors, `attrs.publishedRouteId` is `undefined`. The second test passes already (that is intentional; it is a regression lock, not new behavior).

- [ ] **Step 3: Add the attribute**

In `apps/run.gpx/webapp/src/entities/gpx-file.ts`, immediately after the `conDay` attribute and before the closing `},` of `attributes`:

```ts
      // Links this route to its published public face (entities/route.ts), set
      // when the owner picks "Public on the map" and cleared only if the Route
      // row is deleted. Schema-on-write: absent on every pre-existing row, so
      // no migration. Route.sourceGpxFileId points the other way.
      publishedRouteId: {
        type: "string",
        required: false,
      },
```

- [ ] **Step 4: Add the client types**

In `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts`, in `interface CloudFile`, after the `shareRequested` field:

```ts
  // Set when this route is published to the community map. Its presence is the
  // client-side signal for "this row is Public" and gates the auto-save resync.
  publishedRouteId?: string;
```

In the same file, in `interface RouteSummary`, after `downloadUrl`:

```ts
  // Present when this Route was minted from a GpxFile. Its ABSENCE marks an
  // orphan — a Route from the retired card form, which My Routes adopts into
  // the single list.
  sourceGpxFileId?: string;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/entities/share-link.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/run.gpx/webapp/src/entities/gpx-file.ts \
        apps/run.gpx/webapp/src/entities/share-link.test.ts \
        apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts
git commit -m "feat(gpx): link GpxFile to its published Route via publishedRouteId"
```

---

### Task 2: Pure share-state logic

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/share-state.ts`
- Test: `apps/run.gpx/webapp/src/lib/share-state.test.ts`

**Interfaces:**
- Consumes: Task 1's `publishedRouteId`.
- Produces:
  - `type ShareState = "private" | "link" | "public"`
  - `isShareState(v: unknown): v is ShareState`
  - `deriveShareState(input: { publishedRouteId?: string; hasActiveLink: boolean }): ShareState`
  - `canGoPublic(file: { publicShareEligible?: boolean; source?: string; status: string }): { ok: true } | { ok: false; reason: "inactive" | "needs-conversion" }`

- [ ] **Step 1: Write the failing test**

Create `apps/run.gpx/webapp/src/lib/share-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isShareState,
  deriveShareState,
  canGoPublic,
} from "./share-state";

describe("isShareState", () => {
  it("accepts exactly the three states", () => {
    expect(isShareState("private")).toBe(true);
    expect(isShareState("link")).toBe(true);
    expect(isShareState("public")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isShareState("published")).toBe(false);
    expect(isShareState("")).toBe(false);
    expect(isShareState(undefined)).toBe(false);
    expect(isShareState(3)).toBe(false);
  });
});

describe("deriveShareState", () => {
  it("is public when a published route is linked — public outranks a link", () => {
    expect(
      deriveShareState({ publishedRouteId: "r1", hasActiveLink: true })
    ).toBe("public");
  });

  it("is link when a token exists and nothing is published", () => {
    expect(deriveShareState({ hasActiveLink: true })).toBe("link");
  });

  it("is private with neither", () => {
    expect(deriveShareState({ hasActiveLink: false })).toBe("private");
  });
});

describe("canGoPublic", () => {
  it("allows an active, eligible file", () => {
    expect(
      canGoPublic({ status: "active", publicShareEligible: true, source: "upload" })
    ).toEqual({ ok: true });
  });

  it("treats a legacy file with no eligibility flag as eligible", () => {
    expect(canGoPublic({ status: "active" })).toEqual({ ok: true });
  });

  it("rejects a non-active file", () => {
    expect(canGoPublic({ status: "pending" })).toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("flags a raw Strava import as needing conversion first", () => {
    expect(
      canGoPublic({
        status: "active",
        publicShareEligible: false,
        source: "strava",
      })
    ).toEqual({ ok: false, reason: "needs-conversion" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/share-state.test.ts`
Expected: FAIL — "Failed to resolve import ./share-state".

- [ ] **Step 3: Write the implementation**

Create `apps/run.gpx/webapp/src/lib/share-state.ts`:

```ts
/**
 * Share-state vocabulary for the unified routes design (2026-08-01 spec).
 *
 * One route has exactly one of three states. The state is DERIVED from storage
 * rather than stored as its own column, so there is nothing to migrate and no
 * way for a flag to drift out of sync with the rows it describes:
 *   private → no published Route, no live share token
 *   link    → a GpxShare token exists
 *   public  → publishedRouteId points at a published Route
 *
 * Pure functions only — no AWS, no session. The route handler owns the I/O.
 */

export type ShareState = "private" | "link" | "public";

const STATES: readonly string[] = ["private", "link", "public"];

export function isShareState(value: unknown): value is ShareState {
  return typeof value === "string" && STATES.includes(value);
}

/**
 * Public outranks link: a route can carry a stale token from before it was
 * published, and the map listing is the stronger, more visible claim.
 */
export function deriveShareState(input: {
  publishedRouteId?: string;
  hasActiveLink: boolean;
}): ShareState {
  if (input.publishedRouteId) return "public";
  if (input.hasActiveLink) return "link";
  return "private";
}

/**
 * Compliance gate (Strava API terms). A raw import is publicShareEligible:false
 * and cannot be published as-is; the caller must mint a converted copy first.
 * `undefined` means a legacy row predating the flag, which defaults to eligible
 * exactly like the entity's own default.
 */
export function canGoPublic(file: {
  status: string;
  publicShareEligible?: boolean;
  source?: string;
}): { ok: true } | { ok: false; reason: "inactive" | "needs-conversion" } {
  if (file.status !== "active") return { ok: false, reason: "inactive" };
  if (file.publicShareEligible === false) {
    return { ok: false, reason: "needs-conversion" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run src/lib/share-state.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/webapp/src/lib/share-state.ts \
        apps/run.gpx/webapp/src/lib/share-state.test.ts
git commit -m "feat(gpx): pure share-state derivation and public-eligibility gate"
```

---

### Task 3: The visibility transition endpoint

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility.test.ts`

**Interfaces:**
- Consumes: Task 1 `publishedRouteId`; Task 2 `isShareState`, `deriveShareState`, `canGoPublic`.
- Produces: `PUT /api/gpx/files/[id]/visibility` with body `{ state: ShareState }`, responding `200 { state, routeId?, shareUrl? }`.

- [ ] **Step 1: Write the failing test**

Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  fileSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeGet: vi.fn(),
  routeCreate: vi.fn(() => ({ go: vi.fn(async () => ({ data: {} })) })),
  routeSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeByOwner: vi.fn(async () => ({ data: [] })),
  shareByFile: vi.fn(async () => ({ data: [] })),
  shareCreate: vi.fn(() => ({ go: vi.fn(async () => ({ data: {} })) })),
  shareDelete: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  s3Send: vi.fn(async () => ({})),
  logEvent: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
  getRouteKey: (id: string) => `uploads/ROUTES/${id}.gpx`,
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.fileSet, remove: mocks.fileRemove }),
  },
}));
vi.mock("@/entities/route", () => ({
  Route: {
    get: (k: unknown) => ({ go: () => mocks.routeGet(k) }),
    create: mocks.routeCreate,
    update: () => ({ set: mocks.routeSet, remove: mocks.routeRemove }),
    query: {
      byOwner: () => ({ go: mocks.routeByOwner }),
    },
  },
}));
vi.mock("@/entities/gpx-share", () => ({
  GpxShare: {
    query: { byFile: () => ({ go: mocks.shareByFile }) },
    create: mocks.shareCreate,
    delete: mocks.shareDelete,
  },
}));

import { PUT } from "./visibility/route";

const OWNER = "owner-sub-1";

function req(body: unknown) {
  return new Request("http://localhost/api/gpx/files/f1/visibility", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "f1" }) };

function activeFile(extra: Record<string, unknown> = {}) {
  return {
    data: {
      userId: OWNER,
      fileId: "f1",
      fileName: "strip-loop.gpx",
      bucket: "test-bucket",
      key: `uploads/${OWNER}/f1.gpx`,
      fileSize: 1234,
      status: "active",
      version: 1,
      ...extra,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: OWNER, name: "Runner", services: ["gpxstudio"] },
  });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.fileGet.mockResolvedValue(activeFile());
  mocks.routeByOwner.mockResolvedValue({ data: [] });
  mocks.shareByFile.mockResolvedValue({ data: [] });
});

describe("PUT /api/gpx/files/[id]/visibility — gates", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(401);
  });

  it("403s without the gpxstudio service", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OWNER, services: [] } });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(403);
  });

  it("403s a locked-out identity", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(403);
  });

  it("400s an unknown state", async () => {
    expect((await PUT(req({ state: "published" }), ctx)).status).toBe(400);
  });

  it("404s a file the caller does not own", async () => {
    mocks.fileGet.mockResolvedValue({ data: null });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(404);
  });
});

describe("private -> public", () => {
  it("mints a Route, publishes it, and persists publishedRouteId", async () => {
    const response = await PUT(req({ state: "public" }), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe("public");
    expect(body.routeId).toEqual(expect.any(String));

    // S3 object copied to the sentinel ROUTES key — never a user-identified path.
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    const created = mocks.routeCreate.mock.calls[0][0];
    expect(created.key).toBe(`uploads/ROUTES/${body.routeId}.gpx`);
    expect(created.ownerId).toBe(OWNER);
    expect(created.visibility).toBe("published");
    expect(created.publishedAt).toEqual(expect.any(Number));
    expect(created.sourceGpxFileId).toBe("f1");
    expect(created).not.toHaveProperty("conDay");

    expect(mocks.fileSet).toHaveBeenCalledWith({
      publishedRouteId: body.routeId,
    });
  });

  it("reuses the existing Route instead of minting a second one", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ publishedRouteId: "r-existing" }));
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r-existing", ownerId: OWNER, status: "active", visibility: "private", copyCount: 7 },
    });

    const body = await (await PUT(req({ state: "public" }), ctx)).json();

    expect(body.routeId).toBe("r-existing");
    expect(mocks.routeCreate).not.toHaveBeenCalled();
    expect(mocks.s3Send).toHaveBeenCalledTimes(1); // content refreshed, not re-minted
    expect(mocks.routeSet).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "published" })
    );
  });

  it("429s when the publish cap is reached", async () => {
    mocks.routeByOwner.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, i) => ({
        routeId: `r${i}`,
        visibility: "published",
      })),
    });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(429);
  });

  it("429s when the total route cap is reached", async () => {
    mocks.routeByOwner.mockResolvedValue({
      data: Array.from({ length: 50 }, (_, i) => ({
        routeId: `r${i}`,
        visibility: "private",
      })),
    });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(429);
  });
});

describe("Strava compliance", () => {
  it("auto-converts a raw import and publishes the converted copy, not the import", async () => {
    mocks.fileGet.mockResolvedValue(
      activeFile({ publicShareEligible: false, source: "strava", stravaActivityId: "9" })
    );

    const body = await (await PUT(req({ state: "public" }), ctx)).json();
    const created = mocks.routeCreate.mock.calls[0][0];

    expect(body.state).toBe("public");
    expect(created.source).toBe("converted");
    // The converted route must not carry the Strava activity id forward.
    expect(created).not.toHaveProperty("stravaActivityId");
  });

  it("never publishes a non-active file", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ status: "pending" }));
    const response = await PUT(req({ state: "public" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.routeCreate).not.toHaveBeenCalled();
  });
});

describe("public -> private", () => {
  it("unpublishes but keeps the Route row so copyCount survives", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ publishedRouteId: "r-existing" }));
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r-existing", ownerId: OWNER, status: "active", visibility: "published", copyCount: 7 },
    });

    const body = await (await PUT(req({ state: "private" }), ctx)).json();

    expect(body.state).toBe("private");
    expect(mocks.routeSet).toHaveBeenCalledWith({ visibility: "private" });
    expect(mocks.routeRemove).toHaveBeenCalledWith(["publishedAt"]);
    // The Route row itself is NOT deleted.
    expect(mocks.fileRemove).toHaveBeenCalledWith(["publishedRouteId"]);
  });

  it("survives a linked Route that no longer exists", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ publishedRouteId: "r-gone" }));
    mocks.routeGet.mockResolvedValue({ data: null });

    const response = await PUT(req({ state: "private" }), ctx);
    expect(response.status).toBe(200);
    expect(mocks.fileRemove).toHaveBeenCalledWith(["publishedRouteId"]);
  });
});

describe("link state", () => {
  it("mints a public token share and returns its URL", async () => {
    const body = await (await PUT(req({ state: "link" }), ctx)).json();

    expect(body.state).toBe("link");
    expect(body.shareUrl).toContain("/studio/share/");
    expect(mocks.shareCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ fileId: "f1", ownerId: OWNER, accessMode: "public" })
    );
  });

  it("revokes every live token when going back to private", async () => {
    mocks.shareByFile.mockResolvedValue({
      data: [{ shareId: "s1" }, { shareId: "s2" }],
    });

    await PUT(req({ state: "private" }), ctx);

    expect(mocks.shareDelete).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run "src/app/api/gpx/files/[id]/visibility.test.ts"`
Expected: FAIL — "Failed to resolve import ./visibility/route".

- [ ] **Step 3: Write the implementation**

Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { nanoid } from "nanoid";
import { GpxFile } from "@/entities/gpx-file";
import { Route } from "@/entities/route";
import { GpxShare } from "@/entities/gpx-share";
import { s3Client, BUCKET, getRouteKey } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { sanitizeCardText } from "@/lib/route-card";
import { isRouteCapped, isPublishCapped } from "@/lib/route-caps";
import { isShareState, canGoPublic, type ShareState } from "@/lib/share-state";
import { logEvent } from "@/lib/log-event";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/gpx/files/[id]/visibility — the single share transition for a route
 * (2026-08-01 unified-routes spec).
 *
 * Body: { state: "private" | "link" | "public" }
 *
 * This is orchestration, not new sharing machinery: it composes the same
 * primitives the standalone endpoints use (Route mint + publish/unpublish,
 * GpxShare token mint/revoke, the convert-public compliance copy). The
 * standalone /routes/[id]/publish|unpublish endpoints stay, because orphan
 * Route rows have no backing GpxFile to address here.
 *
 * The states are exclusive. Moving to any state tears down the others, so a
 * route can never be simultaneously link-shared and map-published.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;
  const userId = session.user.id;

  let state: ShareState;
  try {
    const body = await request.json();
    if (!isShareState(body?.state)) {
      return NextResponse.json(
        { error: "state must be 'private', 'link' or 'public'" },
        { status: 400 }
      );
    }
    state = body.state;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Ownership. 404 (not 403) on a miss — non-disclosure posture.
    const fileResult = await GpxFile.get({ userId, fileId: id }).go();
    const file = fileResult.data;
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // --- Always tear down link shares first. Every state either wants them
    // gone (private, public) or wants a fresh one (link). ---
    const existingShares = await GpxShare.query
      .byFile({ ownerId: userId, fileId: id })
      .go({ pages: "all" });
    for (const share of existingShares.data ?? []) {
      await GpxShare.delete({ shareId: share.shareId }).go();
    }

    if (state === "link") {
      const shareId = nanoid(21);
      await GpxShare.create({
        shareId,
        ownerId: userId,
        fileId: id,
        version: file.version ?? 1,
        accessMode: "public",
      }).go();

      logEvent("gpx.share.link", {
        headers: request.headers,
        userId,
        email: session.user.email ?? undefined,
        meta: { fileId: id },
      });

      return NextResponse.json({ state, shareUrl: buildShareUrl(shareId) });
    }

    // --- Resolve the currently linked Route, if any. ---
    const linkedId = file.publishedRouteId;
    let linked = null;
    if (linkedId) {
      const got = await Route.get({ routeId: linkedId }).go();
      // A row that vanished, or that somehow is not ours, is treated as absent
      // so the file can always be repaired back to a coherent state.
      if (got.data && got.data.ownerId === userId) linked = got.data;
    }

    if (state === "private") {
      if (linked) {
        await Route.update({ routeId: linked.routeId })
          .set({ visibility: "private" })
          .go();
        // publishedAt is byVisibility's sk: removing it drops the row out of
        // the community index entirely rather than merely filtering it.
        await Route.update({ routeId: linked.routeId })
          .remove(["publishedAt"])
          .go();
      }
      if (linkedId) {
        await GpxFile.update({ userId, fileId: id })
          .remove(["publishedRouteId"])
          .go();
      }

      logEvent("gpx.share.private", {
        headers: request.headers,
        userId,
        email: session.user.email ?? undefined,
        meta: { fileId: id, routeId: linkedId },
      });

      return NextResponse.json({ state, routeId: linkedId });
    }

    // --- state === "public" ---
    const eligibility = canGoPublic(file);
    if (!eligibility.ok && eligibility.reason === "inactive") {
      return NextResponse.json(
        { error: "Only a fully uploaded route can be shared" },
        { status: 400 }
      );
    }
    // `needs-conversion` is NOT an error here. The spec makes convert-public
    // automatic: we mint the route as a `converted` copy, which is exactly what
    // /files/[id]/convert-public produces, and never publish the raw import
    // itself. stravaActivityId is deliberately not carried across.

    const mine = await Route.query.byOwner({ ownerId: userId }).go({ pages: "all" });
    const isAdmin = services.includes("admin");
    const owned = (mine.data ?? []).filter((r) => r.status !== "failed");
    const publishedCount = owned.filter(
      (r) => r.visibility === "published" && r.routeId !== linkedId
    ).length;
    if (isPublishCapped(publishedCount, isAdmin)) {
      return NextResponse.json(
        { error: "Published route limit reached" },
        { status: 429 }
      );
    }
    if (!linked && isRouteCapped(owned.length, isAdmin)) {
      return NextResponse.json({ error: "Route limit reached" }, { status: 429 });
    }

    const routeId = linked?.routeId ?? uuidv4();
    const key = getRouteKey(routeId);
    const now = Date.now();

    // Server-side copy: the browser never re-uploads, and the public object is
    // a distinct key with no user identifier in its path.
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${file.bucket}/${file.key}`),
        Key: key,
      })
    );

    const metrics = {
      fileSize: file.fileSize,
      trackCount: file.trackCount,
      waypointCount: file.waypointCount,
      totalDistance: file.totalDistance,
      totalElevation: file.totalElevation,
      bounds: file.bounds,
    };

    if (linked) {
      await Route.update({ routeId })
        .set({ ...metrics, visibility: "published", publishedAt: now })
        .go();
    } else {
      await Route.create({
        routeId,
        ownerId: userId,
        name: sanitizeCardText(file.fileName.replace(/\.gpx$/i, "")).slice(0, 80) ||
          "Untitled route",
        bucket: BUCKET,
        key,
        ...metrics,
        status: "active",
        visibility: "published",
        publishedAt: now,
        source: "converted",
        sourceGpxFileId: id,
        createdByName:
          sanitizeCardText(session.user.name ?? "").slice(0, 80) || undefined,
      }).go();

      await GpxFile.update({ userId, fileId: id })
        .set({ publishedRouteId: routeId })
        .go();
    }

    logEvent("gpx.share.public", {
      headers: request.headers,
      userId,
      email: session.user.email ?? undefined,
      meta: { fileId: id, routeId, converted: !eligibility.ok },
    });

    return NextResponse.json({ state, routeId });
  } catch (error) {
    console.error("Error updating visibility:", error);
    return NextResponse.json(
      { error: "Failed to update sharing" },
      { status: 500 }
    );
  }
}

/** Mirrors the URL shape minted by /api/gpx/shares so both agree. */
function buildShareUrl(shareId: string): string {
  const webappOrigin = process.env.WEBAPP_ORIGIN;
  const regionShort = process.env.REGION_SHORT;
  if (webappOrigin && regionShort) {
    return `https://${webappOrigin}/${regionShort}/studio/share/${shareId}`;
  }
  return `http://localhost:${process.env.PORT || "3003"}/studio/share/${shareId}`;
}
```

- [ ] **Step 4: Reconcile `buildShareUrl` with the shipped one**

Open `apps/run.gpx/webapp/src/app/api/gpx/shares/route.ts` around lines 140-155 and read the exact env var names it uses to build `shareUrl`. Copy those names verbatim into `buildShareUrl` above. If they differ from `WEBAPP_ORIGIN` / `REGION_SHORT`, the shipped names win — a mismatch mints share URLs that 404 in production.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run "src/app/api/gpx/files/[id]/visibility.test.ts"`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add "apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility" \
        "apps/run.gpx/webapp/src/app/api/gpx/files/[id]/visibility.test.ts"
git commit -m "feat(gpx): single PUT /files/[id]/visibility transition endpoint"
```

---

### Task 4: Resync endpoint for published routes

**Files:**
- Create: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route/route.ts`
- Test: `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route.test.ts`

**Interfaces:**
- Consumes: Task 1 `publishedRouteId`.
- Produces: `POST /api/gpx/files/[id]/resync-route` → `200 { synced: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  routeGet: vi.fn(),
  routeSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  s3Send: vi.fn(async () => ({})),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: { get: (k: unknown) => ({ go: () => mocks.fileGet(k) }) },
}));
vi.mock("@/entities/route", () => ({
  Route: {
    get: (k: unknown) => ({ go: () => mocks.routeGet(k) }),
    update: () => ({ set: mocks.routeSet }),
  },
}));

import { POST } from "./resync-route/route";

const OWNER = "owner-sub-1";
const ctx = { params: Promise.resolve({ id: "f1" }) };
const req = () =>
  new Request("http://localhost/api/gpx/files/f1/resync-route", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: OWNER, services: ["gpxstudio"] } });
  mocks.assertNotLockedLive.mockResolvedValue(false);
});

describe("POST /api/gpx/files/[id]/resync-route", () => {
  it("no-ops cheaply when the route is not published", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: OWNER, fileId: "f1", status: "active" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(false);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("copies content and refreshes metrics for a published route", async () => {
    mocks.fileGet.mockResolvedValue({
      data: {
        userId: OWNER,
        fileId: "f1",
        status: "active",
        publishedRouteId: "r1",
        bucket: "test-bucket",
        key: `uploads/${OWNER}/f1.gpx`,
        fileSize: 999,
        trackCount: 2,
        totalDistance: 5000,
      },
    });
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r1", ownerId: OWNER, key: "uploads/ROUTES/r1.gpx" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(true);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    expect(mocks.routeSet).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: 999, trackCount: 2, totalDistance: 5000 })
    );
  });

  it("does not touch a Route owned by someone else", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: OWNER, fileId: "f1", status: "active", publishedRouteId: "r1" },
    });
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r1", ownerId: "somebody-else" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(false);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.gpx/webapp && npx vitest run "src/app/api/gpx/files/[id]/resync-route.test.ts"`
Expected: FAIL — "Failed to resolve import ./resync-route/route".

- [ ] **Step 3: Write the implementation**

Create `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "@/entities/gpx-file";
import { Route } from "@/entities/route";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { assertNotLockedLive } from "@/lib/live-lockout";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/gpx/files/[id]/resync-route — push a published route's latest
 * content to its public copy (2026-08-01 unified-routes spec).
 *
 * Called by auto-save after the browser's S3 PUT lands, but only for rows the
 * client already knows are Public. The copy happens server-side (S3 → S3), so
 * the browser uploads once regardless of publish state.
 *
 * Always 200 with { synced }. A not-published or already-gone route is a
 * no-op, not an error: auto-save must never surface a failure for a background
 * mirror of content that saved fine.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const { id } = await params;
  const userId = session.user.id;

  try {
    const fileResult = await GpxFile.get({ userId, fileId: id }).go();
    const file = fileResult.data;
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (!file.publishedRouteId) {
      return NextResponse.json({ synced: false });
    }

    const routeResult = await Route.get({ routeId: file.publishedRouteId }).go();
    const route = routeResult.data;
    if (!route || route.ownerId !== userId) {
      return NextResponse.json({ synced: false });
    }

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURI(`${file.bucket}/${file.key}`),
        Key: route.key,
      })
    );

    await Route.update({ routeId: route.routeId })
      .set({
        fileSize: file.fileSize,
        trackCount: file.trackCount,
        waypointCount: file.waypointCount,
        totalDistance: file.totalDistance,
        totalElevation: file.totalElevation,
        bounds: file.bounds,
      })
      .go();

    return NextResponse.json({ synced: true });
  } catch (error) {
    console.error("Error resyncing published route:", error);
    return NextResponse.json({ error: "Failed to resync" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.gpx/webapp && npx vitest run "src/app/api/gpx/files/[id]/resync-route.test.ts"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole webapp suite — nothing else may regress**

Run: `cd apps/run.gpx/webapp && npm test`
Expected: PASS. In particular `delete-reconcile.test.ts`, `conday-update.test.ts` and the strava route tests must be unchanged.

- [ ] **Step 6: Commit**

```bash
git add "apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route" \
        "apps/run.gpx/webapp/src/app/api/gpx/files/[id]/resync-route.test.ts"
git commit -m "feat(gpx): resync a published route's public copy after edits"
```

---

### Task 5: Client helpers

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts` (append near the existing route helpers, after `copyRouteToMyMaps`)

**Interfaces:**
- Consumes: Tasks 3 and 4's endpoints; Task 1's `CloudFile.publishedRouteId` and `RouteSummary.sourceGpxFileId`.
- Produces:
  - `type ShareState = 'private' | 'link' | 'public'`
  - `setShareState(fileId: string, state: ShareState): Promise<{ state: ShareState; routeId?: string; shareUrl?: string }>`
  - `resyncPublishedRoute(fileId: string): Promise<void>`
  - `listOrphanRoutes(): Promise<RouteSummary[]>`

- [ ] **Step 1: Add the helpers**

Append to `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts`:

```ts
/**
 * The one share vocabulary (2026-08-01 unified-routes spec). Mirrors
 * webapp/src/lib/share-state.ts — keep the two in step.
 */
export type ShareState = 'private' | 'link' | 'public';

/** Move a route between Private / Anyone-with-link / Public in one call. */
export async function setShareState(
  fileId: string,
  state: ShareState
): Promise<{ state: ShareState; routeId?: string; shareUrl?: string }> {
  const response = await fetch(
    `${getApiBase()}/files/${encodeURIComponent(fileId)}/visibility`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ state }),
    }
  );
  if (!response.ok) await routeApiError(response, 'Could not update sharing');
  return await response.json();
}

/**
 * Mirror the latest content into a route's public copy. Fire-and-forget: the
 * user's own save already succeeded, so a mirror failure must never surface as
 * a save error. Callers should not await this in a way that can reject.
 */
export async function resyncPublishedRoute(fileId: string): Promise<void> {
  try {
    await fetch(`${getApiBase()}/files/${encodeURIComponent(fileId)}/resync-route`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Intentionally silent — see above.
  }
}

/**
 * Routes with no backing GpxFile: the leftovers from the retired "Create a
 * route" card form. My Routes adopts them so there is one list, not two.
 */
export async function listOrphanRoutes(): Promise<RouteSummary[]> {
  const routes = await listMyRoutes();
  return routes.filter((r) => !r.sourceGpxFileId);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.gpx/gpx-studio/website && npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: no errors referencing `cloud-sync.ts`. (Pre-existing errors elsewhere in gpx-studio are acceptable; compare against `git stash`-free baseline only if unsure.)

- [ ] **Step 3: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts
git commit -m "feat(gpx): setShareState, resyncPublishedRoute, listOrphanRoutes helpers"
```

---

### Task 6: ShareDialog becomes the tri-state control

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/ShareDialog.svelte` (full rewrite of script + markup)

**Interfaces:**
- Consumes: Task 5's `setShareState`, `ShareState`; `CloudFile.publishedRouteId`.
- Produces: props `{ open: bindable<boolean>, file: CloudFile | null, onStateChange?: () => void }`. **The `onSubmitChange` prop is renamed to `onStateChange`** — Task 7 updates the one call site in `CloudStorage.svelte`.

- [ ] **Step 1: Replace the script block**

Replace everything between `<script lang="ts">` and `</script>` in `ShareDialog.svelte` with:

```ts
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import {
        Share2,
        Copy,
        Loader2,
        AlertCircle,
        Check,
        Globe,
        Lock,
        Link2,
    } from '@lucide/svelte';
    import { getApiBase, setShareState, type ShareState, type CloudFile } from '$lib/cloud-sync';

    let {
        open = $bindable(false),
        file = null as CloudFile | null,
        onStateChange = undefined as (() => void) | undefined,
    }: {
        open?: boolean;
        file: CloudFile | null;
        // Fires after a successful transition so My Routes can refresh the row
        // badge without a full reload.
        onStateChange?: (() => void) | undefined;
    } = $props();

    let busy = $state(false);
    let error: string | null = $state(null);
    let state: ShareState = $state('private');
    let shareUrl = $state('');
    let copied = $state(false);
    let aggregate = $state(false);
    let aggregateBusy = $state(false);

    // Seed from the file every time the dialog opens. `publishedRouteId` is the
    // authoritative "this is Public" signal; a live token is discovered by
    // asking the shares endpoint, which is also where we recover its URL.
    $effect(() => {
        if (open && file) {
            error = null;
            shareUrl = '';
            copied = false;
            aggregate = file.includeInAggregate ?? false;
            state = file.publishedRouteId ? 'public' : 'private';
            void loadExistingLink();
        }
    });

    async function loadExistingLink() {
        if (!file || file.publishedRouteId) return;
        try {
            const response = await fetch(`${getApiBase()}/shares?fileId=${file.fileId}`, {
                credentials: 'include',
            });
            if (!response.ok) return;
            const data = await response.json();
            const live = (data.shares ?? [])[0];
            if (live) {
                state = 'link';
                shareUrl = live.shareUrl ?? '';
            }
        } catch {
            // A failed probe just leaves the dialog showing Private; choosing a
            // state re-asserts the truth server-side anyway.
        }
    }

    async function choose(next: ShareState) {
        if (!file || busy || next === state) return;
        busy = true;
        error = null;
        try {
            const result = await setShareState(file.fileId, next);
            state = result.state;
            shareUrl = result.shareUrl ?? '';
            onStateChange?.();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update sharing';
        } finally {
            busy = false;
        }
    }

    // Orthogonal to the three states: anonymity, not sharing.
    async function toggleAggregate(next: boolean) {
        if (!file || aggregateBusy) return;
        aggregateBusy = true;
        error = null;
        try {
            const response = await fetch(
                `${getApiBase()}/files/${file.fileId}/aggregate-optin`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ include: next }),
                }
            );
            if (!response.ok) throw new Error('Could not update the overlay opt-in');
            aggregate = next;
            onStateChange?.();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update the overlay opt-in';
        } finally {
            aggregateBusy = false;
        }
    }

    async function copyToClipboard() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch {
            error = 'Failed to copy to clipboard';
        }
    }
```

- [ ] **Step 2: Verify the aggregate endpoint contract before trusting Step 1**

Read `apps/run.gpx/webapp/src/app/api/gpx/files/[id]/aggregate-optin/route.ts` and confirm the request body key is `include`. If it is named something else (e.g. `optIn`), fix `toggleAggregate` to match. Also confirm `CloudFile` exposes `includeInAggregate`; if it does not, add it to the interface in `cloud-sync.ts` alongside the Task 1 fields:

```ts
  // Opt-in to the anonymous aggregate overlay. Orthogonal to share state.
  includeInAggregate?: boolean;
```

- [ ] **Step 3: Replace the markup block**

Replace everything from `<Dialog.Root` to the final `</Dialog.Root>` with:

```svelte
<Dialog.Root bind:open>
    <Dialog.Content class="!max-w-[460px] !w-[90vw] max-h-[85vh] overflow-y-auto">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Share2 class="h-5 w-5" />
                Share {file?.fileName || 'route'}
            </Dialog.Title>
        </Dialog.Header>

        <div class="space-y-4">
            {#if error}
                <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2">
                    <AlertCircle class="h-4 w-4 flex-shrink-0" />
                    {error}
                </div>
            {/if}

            <RadioGroup.Root
                value={state}
                onValueChange={(v) => choose(v as ShareState)}
                class="space-y-3"
            >
                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="private" id="share-private" disabled={busy} />
                    <Label for="share-private" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Lock class="h-4 w-4" /> Private
                        </span>
                        <span class="block text-xs text-muted-foreground">Only you can see it.</span>
                    </Label>
                </div>

                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="link" id="share-link" disabled={busy} />
                    <Label for="share-link" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Link2 class="h-4 w-4" /> Anyone with the link
                        </span>
                        <span class="block text-xs text-muted-foreground">
                            Hand someone a URL. It stays off the community map.
                        </span>
                    </Label>
                </div>

                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="public" id="share-public" disabled={busy} />
                    <Label for="share-public" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Globe class="h-4 w-4" /> Public on the map
                        </span>
                        <span class="block text-xs text-muted-foreground">
                            Every defcon.run runner can find it and add it to their routes.
                        </span>
                    </Label>
                </div>
            </RadioGroup.Root>

            {#if busy}
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 class="h-4 w-4 animate-spin" /> Updating…
                </div>
            {/if}

            {#if state === 'link' && shareUrl}
                <div class="space-y-2">
                    <Label>Share URL</Label>
                    <div class="flex gap-2">
                        <input
                            type="text"
                            readonly
                            value={shareUrl}
                            class="flex-1 border rounded px-3 py-2 text-sm bg-muted/30 truncate"
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            onclick={copyToClipboard}
                            title="Copy to clipboard"
                        >
                            {#if copied}
                                <Check class="h-4 w-4 text-green-600" />
                            {:else}
                                <Copy class="h-4 w-4" />
                            {/if}
                        </Button>
                    </div>
                </div>
            {/if}

            <!-- Orthogonal to the three states above: this is anonymity, not
                 sharing. The overlay carries zero identifying properties. -->
            <div class="pt-4 border-t">
                <label class="flex items-start gap-2 cursor-pointer text-sm">
                    <input
                        type="checkbox"
                        class="mt-0.5"
                        checked={aggregate}
                        disabled={aggregateBusy}
                        onchange={(e) => toggleAggregate(e.currentTarget.checked)}
                    />
                    <span>
                        Also blend into the anonymous heat overlay
                        <span class="block text-xs text-muted-foreground">
                            Adds the shape only — no name, no link back to you.
                        </span>
                    </span>
                </label>
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 4: Build the frontend to verify the component compiles**

Run: `cd apps/run.gpx && ./build-frontend.sh 2>&1 | tail -30`
Expected: build succeeds. Any Svelte compile error naming `ShareDialog.svelte` must be fixed before moving on.

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/cloud/ShareDialog.svelte \
        apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts
git commit -m "feat(gpx): one tri-state Share control replaces the two-verb dialog"
```

---

### Task 7: My Routes — rename, one list, one menu

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte`

**Interfaces:**
- Consumes: Task 5's `listOrphanRoutes`, `setShareState`; Task 6's renamed `onStateChange` prop.
- Produces: nothing consumed downstream.

**Reminder:** this file is legacy Svelte mode. Use plain `let`, never `$state()`.

- [ ] **Step 1: Update the ShareDialog call site**

Find the line near the bottom:

```svelte
<ShareDialog bind:open={shareDialogOpen} file={fileToShare} onSubmitChange={refreshFiles} />
```

Replace with:

```svelte
<ShareDialog bind:open={shareDialogOpen} file={fileToShare} onStateChange={refreshFiles} />
```

- [ ] **Step 2: Remove the "Save as Route" machinery**

Delete the `onSaveAsRoute` function and the `routeDialogFile` / `routeConvertBusy` / `routeConvertMsg` / `routeConvertErr` declarations from the script, the `createRouteFromFile` import, the `RouteCardForm` import, the `RouteIcon` import if now unused, the `<DropdownMenu.Item>` containing "Save as Route", and the entire `<!-- "Save as route" card dialog -->` block at the bottom of the file.

- [ ] **Step 3: Remove the shareRequested badge**

Delete the `{#if file.shareRequested} … {/if}` block (the `Send` icon span in the file-row title). Remove the `Send` icon from the `@lucide/svelte` import if it is now unused.

- [ ] **Step 4: Show the share state on each row**

The row currently derives a colored share icon from `filesWithShares`. Replace `checkFilesForShares` and its `filesWithShares` set with a direct read of the state, since `publishedRouteId` now travels on the file. In the script, delete `checkFilesForShares` and its `filesWithShares` declaration and the `checkFilesForShares();` call in the load path. Add:

```ts
    // One badge, derived — no extra round trip per file. A live token is not
    // reflected here; the dialog is where link state is inspected.
    function shareBadge(file) {
        return file.publishedRouteId ? 'Public' : 'Private';
    }
```

In the row's metadata line (the `<div class="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">`), add as the first child:

```svelte
                                        <span>{shareBadge(file)}</span>
```

In the dropdown's share item, replace the `{#if filesWithShares.has(file.fileId)}` conditional block with a plain `<span>Share</span>`.

- [ ] **Step 5: Adopt orphan routes into the list**

In the script, add to the imports from `$lib/cloud-sync`: `listOrphanRoutes`, `setShareState`. Add a plain declaration and loader:

```ts
    // Routes with no backing file — leftovers from the retired card form. They
    // render as ordinary rows so there is one list, not two.
    let orphanRoutes = [];

    async function refreshOrphanRoutes() {
        try {
            orphanRoutes = await listOrphanRoutes();
        } catch {
            orphanRoutes = [];
        }
    }

    async function toggleOrphanPublic(route) {
        loading = true;
        try {
            const endpoint = route.visibility === 'published' ? 'unpublish' : 'publish';
            const response = await fetch(
                `${getApiBase()}/routes/${encodeURIComponent(route.routeId)}/${endpoint}`,
                { method: 'POST', credentials: 'include' }
            );
            if (!response.ok) throw new Error('Could not update sharing');
            await refreshOrphanRoutes();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update sharing';
        } finally {
            loading = false;
        }
    }
```

Call `refreshOrphanRoutes()` everywhere `refreshFiles()` is called on dialog open. Then render them after the file list, inside the same section wrapper the files use:

```svelte
                {#each orphanRoutes as route (route.routeId)}
                    <div class="flex items-center gap-3 px-3 py-2 hover:bg-foreground/5">
                        <MapIcon class="h-[17px] w-[17px] flex-shrink-0 text-primary" />
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-sm font-semibold">{route.name}</div>
                            <div class="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                                <span>{route.visibility === 'published' ? 'Public' : 'Private'}</span>
                                {#if route.totalDistance}
                                    <span>· {(route.totalDistance / 1000).toFixed(1)} km</span>
                                {/if}
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-7 px-2.5 text-xs flex-shrink-0"
                            disabled={loading || route.status !== 'active'}
                            onclick={() => toggleOrphanPublic(route)}
                        >
                            {route.visibility === 'published' ? 'Make private' : 'Make public'}
                        </Button>
                    </div>
                {/each}
```

- [ ] **Step 6: Rename the dialog**

Change every user-visible "My Maps" string in this file to "My Routes". Search with:

```bash
grep -n "My Maps" apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte
```

Update the header comment at the top of the file to say "My Routes" and note that the list now adopts orphan `Route` rows.

- [ ] **Step 7: Build**

Run: `cd apps/run.gpx && ./build-frontend.sh 2>&1 | tail -30`
Expected: build succeeds. A `$state()`-related error here means Step 5 used runes in a legacy-mode file — convert to plain `let`.

- [ ] **Step 8: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte
git commit -m "feat(gpx): My Routes — one list adopting orphan routes, one Share menu"
```

---

### Task 8: Delete the separate route-creation flow

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/QuickStartHub.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `View` narrows to `'collapsed' | 'hub' | 'logrun'`.

- [ ] **Step 1: Narrow the view union and delete the route state**

Change:

```ts
    type View = 'collapsed' | 'hub' | 'logrun' | 'routebuild';
```

to:

```ts
    type View = 'collapsed' | 'hub' | 'logrun';
```

Delete every declaration and function in the `// ---- Create a route ----` region: `routeFileInput`, `pendingRouteCard`, `routeBusy`, `routeMsg`, `routeErr`, `myRoutes`, `loadingRoutes`, `editingRouteId`, `refreshMyRoutes`, `openRouteBuild`, `onRouteCardSubmit`, `onRouteFilePicked`, `toggleRoutePublish`, `onRouteEditSubmit`, `removeRoute`, `routeDistance`.

- [ ] **Step 2: Prune the imports**

From the `$lib/cloud-sync` import, remove `listMyRoutes`, `createRouteFromContent`, `updateRouteCard`, `deleteRoute`, `publishRoute`, `unpublishRoute`, `type RouteSummary` — keep `getConDayUsage`, `QuotaExceededError`, `type ConDayUsage`. Delete the `RouteCardForm` import. From `@lucide/svelte`, remove `Route as RouteIcon`, `Pencil`, `Trash2`, `Globe`, `Lock`.

- [ ] **Step 3: Delete the markup**

Delete the hidden `<input bind:this={routeFileInput} …>` element, the entire `{:else if view === 'routebuild'}` branch, and the "Create a route" `<button>` in the hub grid.

- [ ] **Step 4: Make "Log a run" the green glowing card**

The hub's Log-a-run button currently uses `border-primary/40 bg-primary/5`. Replace its class attribute with:

```svelte
                        class="add-run-glow flex items-center gap-3 rounded-lg p-3 text-left transition"
```

and change its icon colour class from `text-primary` to `text-white`, and the description span from `text-muted-foreground` to `text-white/80`. `.add-run-glow` is defined in `Menu.svelte`'s scoped `<style>`, so add the same rule to a `<style>` block at the end of `QuickStartHub.svelte`:

```svelte
<style>
    /* Mirrors Menu.svelte's .add-run-glow so every "add a run" surface reads
       the same: bright green, softly pulsing, still legible with reduced motion. */
    .add-run-glow {
        background: #22c55e;
        color: #fff;
        animation: add-run-pulse 2.1s ease-in-out infinite;
    }
    .add-run-glow:hover {
        background: #16a34a;
        filter: brightness(1.05);
    }
    @keyframes add-run-pulse {
        0%,
        100% {
            box-shadow: 0 0 6px 1px rgb(34 197 94 / 0.6);
        }
        50% {
            box-shadow: 0 0 18px 5px rgb(34 197 94 / 0.95);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .add-run-glow {
            animation: none;
            box-shadow: 0 0 10px 2px rgb(34 197 94 / 0.8);
        }
    }
    /* Strava orange, so orange consistently means Strava and green means run. */
    .strava-cta {
        background: #fc4c02;
        color: #fff;
        border-color: #fc4c02;
    }
    .strava-cta:hover {
        filter: brightness(1.08);
    }
</style>
```

- [ ] **Step 5: Make "From Strava" orange**

Replace the From-Strava button's class attribute with:

```svelte
                                class="strava-cta mt-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition"
```

- [ ] **Step 6: Update the copy**

In the `logrun` sub-flow there is no route copy to change, but the hub heading list loses a card. Confirm the remaining three cards read: "Log a run", "Check out the routes", "Show me the runners".

- [ ] **Step 7: Build**

Run: `cd apps/run.gpx && ./build-frontend.sh 2>&1 | tail -30`
Expected: build succeeds with no "unused import" or "undefined variable" errors for `QuickStartHub.svelte`.

- [ ] **Step 8: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/QuickStartHub.svelte
git commit -m "feat(gpx): drop the separate Create-a-route flow; green Log-a-run, orange Strava"
```

---

### Task 9: Menu rename, glow, and community-layer copy

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/Menu.svelte`
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/community-routes.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Rename My Maps in the menu**

In `Menu.svelte`, change the `My Maps...` menubar item label to `My Routes...` and update the `Ctrl/Cmd+O` comment near line 604 from "open My Maps (the unified cloud folder view)" to "open My Routes (the unified cloud route list)".

- [ ] **Step 2: Glow the menubar Add-run item**

Change:

```svelte
                    <Menubar.Item onclick={() => quickStartOpen.set(true)}>
                        <Footprints size="16" />
                        Add run...
                    </Menubar.Item>
```

to:

```svelte
                    <Menubar.Item
                        class="add-run-glow !text-white focus:!text-white"
                        onclick={() => quickStartOpen.set(true)}
                    >
                        <Footprints size="16" />
                        Add run...
                    </Menubar.Item>
```

The `!text-white` is required: the generic `div :global(button)` rule in this file's `<style>` block sets a hover background that would otherwise fight the green.

- [ ] **Step 3: Rename the community-layer action**

In `community-routes.ts`, change the popup button copy `Add to My Maps` to `Add to My Routes`. Verify with:

```bash
grep -rn "My Maps" apps/run.gpx/gpx-studio/website/src apps/run.gpx/webapp/src
```

Every remaining hit outside a code comment describing history must be updated to "My Routes".

- [ ] **Step 4: Build**

Run: `cd apps/run.gpx && ./build-frontend.sh 2>&1 | tail -30`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/Menu.svelte \
        apps/run.gpx/gpx-studio/website/src/lib/components/map/community-routes.ts
git commit -m "feat(gpx): rename My Maps to My Routes, glow every Add-run surface"
```

---

### Task 10: Auto-save mirrors published routes

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/auto-save.ts` (the save loop around lines 320-345)

**Interfaces:**
- Consumes: Task 5's `resyncPublishedRoute`; `CloudFile.publishedRouteId`.
- Produces: nothing.

- [ ] **Step 1: Import the helper and the file cache**

Add `resyncPublishedRoute` to the existing `$lib/cloud-sync` import in `auto-save.ts`. Confirm `cloudFiles` and svelte's `get` are already imported; if not, add:

```ts
import { get } from 'svelte/store';
import { cloudFiles } from '$lib/cloud-sync';
```

- [ ] **Step 2: Mirror after the content write**

Immediately after the existing `await updateCloudFileContent(...)` call and before the "Update tracking info" block, insert:

```ts
        // If this route is Public, mirror the new content into its public copy
        // so the community map shows the edit within one auto-save cycle. The
        // copy is server-side (S3 → S3); the browser still uploads exactly once.
        // Gated on the cached publishedRouteId so unpublished routes — the vast
        // majority — pay nothing.
        const cached = get(cloudFiles).find((f) => f.fileId === info.cloudFileId);
        if (cached?.publishedRouteId) {
          await resyncPublishedRoute(info.cloudFileId);
        }
```

`resyncPublishedRoute` swallows its own errors by design, so this `await` cannot break a successful save.

- [ ] **Step 3: Build**

Run: `cd apps/run.gpx && ./build-frontend.sh 2>&1 | tail -30`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/auto-save.ts
git commit -m "feat(gpx): auto-save mirrors edits into a published route's public copy"
```

---

### Task 11: E2E selectors and full verification

**Files:**
- Modify: `apps/run.gpx/e2e/cloud-storage.spec.ts`
- Modify: `apps/run.gpx/e2e/README.md` (if it names "My Maps")

**Interfaces:**
- Consumes: everything above.
- Produces: a green build and test suite.

- [ ] **Step 1: Find the stale selectors**

```bash
grep -rn "My Maps\|Save as Route\|Create a route\|Submit to DEF CON\|Create Share Link\|Unshare" apps/run.gpx/e2e
```

- [ ] **Step 2: Update each hit**

Rename "My Maps" → "My Routes". Delete any spec step that clicks "Save as Route", "Create a route", or "Submit to DEF CON run" — those flows no longer exist. Replace "Create Share Link" assertions with the new radio labels: `Private`, `Anyone with the link`, `Public on the map`.

- [ ] **Step 3: Run the webapp test suite**

Run: `cd apps/run.gpx/webapp && npm test`
Expected: PASS, including the new `share-state`, `share-link`, `visibility` and `resync-route` suites and every pre-existing suite.

- [ ] **Step 4: Run the production build**

Run: `cd apps/run.gpx && ./build-frontend.sh && cd webapp && npm run build 2>&1 | tail -20`
Expected: both succeed.

- [ ] **Step 5: Lint**

Run: `cd apps/run.gpx/webapp && npm run lint`
Expected: no new errors. Unused-import errors from Tasks 7 and 8 must be cleaned up here if any survived.

- [ ] **Step 6: Confirm the removed surfaces are really gone**

```bash
grep -rn "routebuild\|Save as Route\|shareRequested" \
  apps/run.gpx/gpx-studio/website/src apps/run.gpx/webapp/src/app/studio
```

Expected: no hits in UI components. Hits in `webapp/src/app/api/**` and `webapp/src/entities/**` are correct — the server endpoints and the entity attribute stay.

- [ ] **Step 7: Commit**

```bash
git add apps/run.gpx/e2e
git commit -m "test(gpx): update e2e selectors for the unified routes UI"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Data model — `publishedRouteId` | 1 |
| Client type plumbing (`sourceGpxFileId`, `publishedRouteId`) | 1 |
| The Share control (three states + aggregate checkbox) | 6 |
| Transitions table incl. Strava auto-convert | 2, 3 |
| Gates (401/403/403, 404 on owner mismatch) | 3 |
| One list adopting orphans | 5, 7 |
| Deleting semantics | unchanged behavior — `DELETE /routes/{id}` already correct; verified in Task 11 Step 6 |
| Staleness / auto-resync | 4, 5, 10 |
| Entry points (remove Create-a-route, Save-as-Route, rename) | 7, 8, 9 |
| Buttons (green glow, Strava orange) | 8, 9 |
| Verification list | 1 (conDay lock), 3 (round-trip, Strava, caps), 4 (resync), 11 (e2e) |

**Placeholder scan:** none — every step carries literal code or a literal command.

**Type consistency:** `ShareState` is defined once in `webapp/src/lib/share-state.ts` (Task 2) and mirrored in `cloud-sync.ts` (Task 5) with a comment binding them. `setShareState` returns `{ state, routeId?, shareUrl? }` in Task 5, matching the Task 3 handler's response shape exactly. `onSubmitChange` → `onStateChange` is renamed in Task 6 and its single call site updated in Task 7 Step 1.

**Known verification gaps, deliberately left to run-time steps rather than guessed at:** Task 3 Step 4 (share URL env var names) and Task 6 Step 2 (aggregate-optin body key) both require reading a shipped file before trusting the code above. Both are called out as explicit steps rather than assumed.
