# Class-Based Ringtone Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign each Meshtastic radio a ringtone (RTTTL tune) chosen by the runner's per-user `ringtone` field, falling back to a class default keyed off `mqttUsertype` (rabbit/hare/og/admin), set by an admin from the run.human console and written to the device by run.flash.

**Architecture:** One precedence chain — `RunUser.ringtone` (per-user override) → `ringtoneForClass(mqttUsertype)` (class default) → rabbit default. run.human owns the field + admin setter + internal-API exposure; run.flash reads it in `GET /api/config`, resolves the tune, and pushes it in a new `pushDeviceConfig` stage via an `AdminMessage.set_ringtone_message` on the `ADMIN_APP` port (mirroring the in-repo `setCannedMessages` template).

**Tech Stack:** Next.js 16 / React 19, ElectroDB (DynamoDB), `@meshtastic/core` 2.6.7 + `@bufbuild/protobuf` 2.8, Vitest.

## Global Constraints

- **Additive only** — `RunUser.ringtone` is a new optional ElectroDB attribute; no migration, null for existing users.
- **RTTTL length cap:** `MAX_RINGTONE_LEN = 230` chars. Reject on write (run.human), clamp defensively on read (run.flash).
- **Admin gate (run.human):** every denial → **bare 404** (never 401/403 body). Gate = `requireAdmin(session)` (sync) + `revalidateAdmin(authUserId)` (async, LIVE claims). Mirrors the existing GET in `api/admin/users/[userId]/route.ts`.
- **Precedence, never empty:** `user.ringtone?.trim()` if non-empty → else `ringtoneForClass(mqttUsertype)` → else (unknown class) rabbit default.
- **Field naming:** plain `ringtone` (device setting, not an MQTT credential) though it lives beside the `mqtt*` provisioning cluster.
- **Offline invariant (run.flash):** no new runtime hosts; README DPLY-06 grep must stay clean.
- **Out of scope:** enabling the External Notification / buzzer module (tune stored, not necessarily audible), public upload UI, generalized config-by-profile.
- **Node for tests:** `nvm use 23.6.0` before `npx vitest` (repo default Node fails vitest).
- **Placeholder tunes** (short, valid RTTTL, swappable in one constant):
  - rabbit: `dcrun:d=8,o=6,b=140:c,e,g,c7`
  - wildhare: `hare:d=16,o=6,b=200:c,e,g,c7,g,e,c,e,g,c7`
  - og: `og:d=8,o=5,b=110:g,p,g,p,e,p,c,2g`
  - admin: `admin:d=8,o=5,b=100:g,g,g,4d#`

---

## File Structure

**run.human** (`apps/run.human/webapp`)
- Create: `src/lib/ringtone.ts` — pure RTTTL validator (`MAX_RINGTONE_LEN`, `validateRingtone`). Server + client safe.
- Create: `src/lib/ringtone.test.ts` — validator unit tests.
- Modify: `src/entities/run-user.ts` — add `ringtone` attribute, `RunUserItem` type field, `updateRunUserProfile` param.
- Modify: `src/app/api/internal/user/[oidcSub]/route.ts` — return `ringtone` in the safe subset.
- Modify: `src/app/api/admin/users/[userId]/route.ts` — add `PATCH` (set/clear ringtone); extend `GET` to return current `ringtone` + `mqttUsertype`.
- Create: `src/app/api/admin/users/[userId]/__tests__/route.test.ts` — PATCH gate + validation + write tests.
- Modify: `src/app/(protected)/admin/AdminConsole.tsx` — `UserDetail` type + a "Ringtone" editor Section in the drawer.

**run.flash** (`apps/run.flash/webapp`)
- Modify: `package.json` — add `vitest` dev dep + `test` script.
- Create: `vitest.config.mts` — mirror run.human (alias `@` → `src`).
- Modify: `src/config/meshtastic.ts` — `RINGTONES`, `MAX_RINGTONE_LEN`, `ringtoneForClass`, `resolveRingtone`.
- Create: `src/config/meshtastic.test.ts` — resolve/fallback/clamp tests.
- Create: `src/lib/ringtone-admin.ts` — `buildRingtoneAdminMessageBytes` (pure, no transport import).
- Create: `src/lib/ringtone-admin.test.ts` — decode round-trip test.
- Modify: `src/types/config.ts` — add `ringtone` to `DeviceConfigPayload`; add `"ringtone"` to `ConfigStage`.
- Modify: `src/app/api/config/route.ts` — read `mqttUsertype`/`ringtone`, add resolved `ringtone` to payload.
- Modify: `src/lib/meshtastic.ts` — new ringtone push stage in `pushDeviceConfig`.
- Modify: `src/hooks/use-configure.ts` — add `"ringtone"` to the `stages` array.
- Modify: `src/components/configure/config-pipeline.tsx` — add a "Ringtone" display stage.

---

## Task 1: RTTTL validator (run.human)

**Files:**
- Create: `apps/run.human/webapp/src/lib/ringtone.ts`
- Test: `apps/run.human/webapp/src/lib/ringtone.test.ts`

**Interfaces:**
- Produces: `MAX_RINGTONE_LEN: 230`; `validateRingtone(input: string | null | undefined): { ok: true; value: string | null } | { ok: false; reason: string }`. `null`/empty → `{ ok: true, value: null }` (clears the field). Pure, no imports — importable from both server routes and the client console.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.human/webapp/src/lib/ringtone.test.ts
import { describe, it, expect } from "vitest";
import { validateRingtone, MAX_RINGTONE_LEN } from "./ringtone";

describe("validateRingtone", () => {
  it("accepts a well-formed RTTTL string", () => {
    const r = validateRingtone("dcrun:d=8,o=6,b=140:c,e,g,c7");
    expect(r).toEqual({ ok: true, value: "dcrun:d=8,o=6,b=140:c,e,g,c7" });
  });
  it("trims surrounding whitespace", () => {
    const r = validateRingtone("  og:d=8,o=5,b=110:g,p,g  ");
    expect(r).toEqual({ ok: true, value: "og:d=8,o=5,b=110:g,p,g" });
  });
  it("treats null/empty/blank as a clear (value null)", () => {
    expect(validateRingtone(null)).toEqual({ ok: true, value: null });
    expect(validateRingtone(undefined)).toEqual({ ok: true, value: null });
    expect(validateRingtone("   ")).toEqual({ ok: true, value: null });
  });
  it("rejects strings over the length cap", () => {
    const long = "x:d=8:" + "c,".repeat(200);
    const r = validateRingtone(long);
    expect(r.ok).toBe(false);
  });
  it("rejects non-RTTTL shapes (needs name:defaults:notes)", () => {
    expect(validateRingtone("just some text").ok).toBe(false);
    expect(validateRingtone("a:b").ok).toBe(false);
    expect(validateRingtone("::").ok).toBe(false);
  });
  it("exposes the cap constant", () => {
    expect(MAX_RINGTONE_LEN).toBe(230);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && nvm use 23.6.0 && npx vitest run src/lib/ringtone.test.ts`
Expected: FAIL — `Cannot find module './ringtone'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/run.human/webapp/src/lib/ringtone.ts
/**
 * RTTTL ringtone validation — shared by the admin PATCH route (server) and the
 * admin console editor (client). Pure, no imports, so it is safe on both sides.
 *
 * A ringtone is a Meshtastic RTTTL string ("name:defaults:notes"). We keep the
 * structural check permissive (do NOT reimplement a full RTTTL parser) but
 * enforce the shape + the firmware length cap. null / empty means "clear the
 * field" (revert the runner to their class default).
 */
export const MAX_RINGTONE_LEN = 230;

export type RingtoneValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

export function validateRingtone(
  input: string | null | undefined
): RingtoneValidation {
  if (input == null) return { ok: true, value: null };
  const s = String(input).trim();
  if (s.length === 0) return { ok: true, value: null };
  if (s.length > MAX_RINGTONE_LEN) {
    return { ok: false, reason: `too_long (max ${MAX_RINGTONE_LEN})` };
  }
  const parts = s.split(":");
  if (parts.length !== 3 || parts.some((p) => p.trim().length === 0)) {
    return { ok: false, reason: "not_rtttl (expected name:defaults:notes)" };
  }
  return { ok: true, value: s };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/ringtone.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/ringtone.ts apps/run.human/webapp/src/lib/ringtone.test.ts
git commit -m "feat(human): RTTTL ringtone validator (shared server/client)"
```

---

## Task 2: RunUser.ringtone field + type + update helper + internal API (run.human)

**Files:**
- Modify: `apps/run.human/webapp/src/entities/run-user.ts` (attributes block after `mqttUsertype` ~line 76; `updateRunUserProfile` data param ~line 321; `RunUserItem` type ~line 489)
- Modify: `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` (safe-subset response ~line 89)

**Interfaces:**
- Produces: `RunUser` entity gains optional string attribute `ringtone`; `RunUserItem` gains `ringtone?: string`; `updateRunUserProfile(userId, { ringtone?: string | null, ... })` accepts it; internal `GET /api/internal/user/[oidcSub]` response gains `ringtone`.
- Consumes: nothing new.

- [ ] **Step 1: Add the entity attribute**

In `src/entities/run-user.ts`, immediately after the `mqttUsertype` attribute block, add:

```ts
      // Per-user Meshtastic ringtone (RTTTL). Optional override; when unset the
      // flasher falls back to a class default keyed off mqttUsertype. Set by an
      // admin from the run.human console; NOT a secret (device config, like
      // mqttUsertype). See run.flash config/meshtastic.ts resolveRingtone().
      ringtone: {
        type: "string",
      },
```

- [ ] **Step 2: Extend the `updateRunUserProfile` data param**

In `src/entities/run-user.ts`, in `updateRunUserProfile`'s `data` object type, add `ringtone` (allow `null` to clear):

```ts
  data: {
    displayName?: string;
    displayNameManual?: boolean;
    bio?: string;
    ringtone?: string | null;
    preferences?: {
      theme?: string;
      units?: string;
      privacyLevel?: string;
      checkinPreference?: string;
    };
  }
```

- [ ] **Step 3: Extend the `RunUserItem` type**

In `src/entities/run-user.ts`, in the `RunUserItem` type, after the `mqttUsertype` line add:

```ts
  ringtone?: string;
```

- [ ] **Step 4: Return `ringtone` from the internal user API**

In `src/app/api/internal/user/[oidcSub]/route.ts`, in the final safe-subset `NextResponse.json({...})` (the one returning `mqttUsertype`, `hash`, `email`), add:

```ts
      ringtone: user.ringtone,
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/run.human/webapp && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/entities/run-user.ts apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
git commit -m "feat(human): RunUser.ringtone field + expose via internal user API"
```

---

## Task 3: Admin PATCH/GET for ringtone (run.human)

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/admin/users/[userId]/route.ts`
- Test: `apps/run.human/webapp/src/app/api/admin/users/[userId]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `revalidateAdmin` (from `@/lib/admin-gate`); `validateRingtone` (Task 1); `getRunUser`, `updateRunUserProfile` (Task 2).
- Produces: `PATCH /api/admin/users/[userId]` with body `{ ringtone: string | null }` → `{ ok: true, ringtone: string | null }` on success, else bare 404 (gate) / 400 (invalid RTTTL). `GET` response additionally carries `ringtone` and `mqttUsertype`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.human/webapp/src/app/api/admin/users/[userId]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockRevalidateAdmin = vi.fn();
const mockUpdate = vi.fn();
const mockGetRunUser = vi.fn();

vi.mock("@/config/auth", () => ({
  auth: (...a: unknown[]) => mockAuth(...a),
  revalidateAdmin: (...a: unknown[]) => mockRevalidateAdmin(...a),
  revalidateGroups: vi.fn(),
}));
vi.mock("@/entities/run-user", () => ({
  getRunUser: (...a: unknown[]) => mockGetRunUser(...a),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
// GET path deps — stub so importing the route never loads AWS.
vi.mock("@/entities/auth-user", () => ({ getAuthUserEmail: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/quota-client", () => ({ getUserQuotas: vi.fn().mockRejectedValue(new Error("no quota")) }));

import { PATCH } from "../route";

const ADMIN = { user: { services: ["admin"], authUserId: "sub-admin" } };

function patchReq(body: unknown) {
  return new Request("http://x/api/admin/users/u1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ userId: "u1" }) };

beforeEach(() => {
  mockAuth.mockReset();
  mockRevalidateAdmin.mockReset().mockResolvedValue(true);
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockGetRunUser.mockReset();
});

describe("PATCH /api/admin/users/[userId] — ringtone", () => {
  it("no session → bare 404, no write", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("not admin → bare 404, no write", async () => {
    mockAuth.mockResolvedValue({ user: { services: ["run"], authUserId: "s" } });
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("stale admin (revalidate false) → bare 404, no write", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockRevalidateAdmin.mockResolvedValue(false);
    const res = await PATCH(patchReq({ ringtone: "og:d=8,o=5,b=110:g" }), ctx);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("invalid RTTTL → 400, no write", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: "not a ringtone" }), ctx);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid RTTTL → 200 and writes the trimmed value", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: "  og:d=8,o=5,b=110:g  " }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("u1", { ringtone: "og:d=8,o=5,b=110:g" });
  });

  it("null clears the field", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await PATCH(patchReq({ ringtone: null }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("u1", { ringtone: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && npx vitest run "src/app/api/admin/users/[userId]/__tests__/route.test.ts"`
Expected: FAIL — `PATCH` is not exported from `../route`.

- [ ] **Step 3: Implement PATCH + extend GET**

In `src/app/api/admin/users/[userId]/route.ts`:

Add imports at the top (alongside the existing imports):

```ts
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import { validateRingtone } from "@/lib/ringtone";
```

In the existing `GET`, after fetching `email`, also read the RunUser so the drawer can prefill. Add near the top of the `try`/body (after `const { userId } = await params;` guard):

```ts
  // Runner profile bits the drawer needs (ringtone editor prefill).
  const runUser = await getRunUser(userId);
```

and include them in the GET `Response.json`:

```ts
  return Response.json(
    {
      userId,
      email,
      quotaTier,
      quotas,
      ringtone: runUser?.ringtone ?? null,
      mqttUsertype: runUser?.mqttUsertype ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
```

Append the `PATCH` handler at the end of the file:

```ts
/**
 * PATCH /api/admin/users/[userId] — set or clear a runner's ringtone (RTTTL).
 *
 * Same non-disclosure gate as GET: every denial → bare 404. `revalidateAdmin`
 * (LIVE claims) denies a just-revoked admin inside the JWT staleness window.
 * Body: { ringtone: string | null } — null/empty clears (reverts to class
 * default). Invalid RTTTL → 400. On success → { ok: true, ringtone }.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const session = await auth();
  if (!requireAdmin(session).ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const { userId } = await params;
  if (!userId) return NOT_FOUND();

  let body: { ringtone?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const raw =
    body.ringtone == null ? null : String(body.ringtone);
  const v = validateRingtone(raw);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.reason }, { status: 400 });
  }

  await updateRunUserProfile(userId, { ringtone: v.value });
  return Response.json(
    { ok: true, ringtone: v.value },
    { headers: { "Cache-Control": "no-store" } }
  );
}
```

Note: `auth`, `NOT_FOUND` are already imported/defined in this file (GET uses them).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run "src/app/api/admin/users/[userId]/__tests__/route.test.ts"`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/run.human/webapp && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/run.human/webapp/src/app/api/admin/users/[userId]/route.ts" "apps/run.human/webapp/src/app/api/admin/users/[userId]/__tests__/route.test.ts"
git commit -m "feat(human): admin PATCH to set/clear runner ringtone + GET prefill"
```

---

## Task 4: Ringtone editor in the admin drawer (run.human)

**Files:**
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx` (`UserDetail` type ~line 50; drawer body inside `overflow-y-auto` container ~after the "Services" Section ~line 620)

**Interfaces:**
- Consumes: `GET /api/admin/users/[userId]` (now returns `ringtone`, `mqttUsertype`); `PATCH` (Task 3); `validateRingtone`, `MAX_RINGTONE_LEN` (Task 1); existing `Section` component (`{ title, children }`).
- Produces: no exports; UI only.

- [ ] **Step 1: Extend the `UserDetail` type**

In `AdminConsole.tsx`, extend the `UserDetail` type:

```ts
type UserDetail = {
  email: string | null;
  quotaTier: string | null;
  quotas: QuotaDetail[];
  ringtone: string | null;
  mqttUsertype: "rabbit" | "admin" | "wildhare" | "og" | null;
};
```

- [ ] **Step 2: Add editor state + save handler**

Add the import near the top of the file:

```ts
import { validateRingtone, MAX_RINGTONE_LEN } from "@/lib/ringtone";
```

Inside the component, next to the other `useState` hooks (~line 144), add:

```ts
  const [ringtoneDraft, setRingtoneDraft] = useState("");
  const [ringtoneSaving, setRingtoneSaving] = useState(false);
  const [ringtoneMsg, setRingtoneMsg] = useState<string | null>(null);
```

In `openUser`, reset the draft when a new user is opened. In the `.then((d: UserDetail) => ...)` callback, set both detail and the draft:

```ts
      .then((d: UserDetail) => {
        setDetail(d);
        setRingtoneDraft(d.ringtone ?? "");
        setRingtoneMsg(null);
      })
```

Add the save handler after `closeDrawer` (uses `selected.userId`):

```ts
  const saveRingtone = async (value: string | null) => {
    if (!selected) return;
    const check = validateRingtone(value);
    if (!check.ok) {
      setRingtoneMsg(check.reason);
      return;
    }
    setRingtoneSaving(true);
    setRingtoneMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/admin/users/${selected.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ringtone: check.value }),
      });
      if (!res.ok) {
        setRingtoneMsg(res.status === 404 ? "not authorized" : `save failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { ringtone: string | null };
      setRingtoneDraft(data.ringtone ?? "");
      setDetail((d) => (d ? { ...d, ringtone: data.ringtone } : d));
      setRingtoneMsg("saved");
    } catch {
      setRingtoneMsg("save failed");
    } finally {
      setRingtoneSaving(false);
    }
  };
```

- [ ] **Step 3: Add the Ringtone Section to the drawer**

In the drawer's `overflow-y-auto` container, immediately after the closing `</Section>` of the "Services" block, add:

```tsx
              <Section title="Ringtone">
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={ringtoneDraft}
                    onChange={(e) => setRingtoneDraft(e.target.value)}
                    placeholder="RTTTL, e.g. og:d=8,o=5,b=110:g,p,g"
                    maxLength={MAX_RINGTONE_LEN}
                    className="w-full rounded-lg border border-divider bg-content2 px-2.5 py-1.5 font-mono text-[12px] focus:border-primary outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveRingtone(ringtoneDraft)}
                      disabled={ringtoneSaving}
                      className="rounded-lg bg-primary px-3 py-1 text-[12px] font-medium text-black disabled:opacity-50"
                    >
                      {ringtoneSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveRingtone(null)}
                      disabled={ringtoneSaving || (!ringtoneDraft && !detail?.ringtone)}
                      className="rounded-lg border border-divider px-3 py-1 text-[12px] text-default-500 hover:text-primary hover:border-primary disabled:opacity-40"
                    >
                      Clear
                    </button>
                    {ringtoneMsg ? (
                      <span
                        className={`text-[11px] ${ringtoneMsg === "saved" ? "text-success" : "text-danger"}`}
                      >
                        {ringtoneMsg}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-default-400">
                    {detail?.ringtone
                      ? "Personal override set."
                      : `Empty → class default (${detail?.mqttUsertype ?? selected.runnerType ?? "rabbit"}).`}
                  </span>
                </div>
              </Section>
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd apps/run.human/webapp && npx tsc --noEmit && npx eslint "src/app/(protected)/admin/AdminConsole.tsx"`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx"
git commit -m "feat(human): ringtone editor in admin user drawer"
```

---

## Task 5: run.flash test setup + ringtone resolution (run.flash)

**Files:**
- Modify: `apps/run.flash/webapp/package.json`
- Create: `apps/run.flash/webapp/vitest.config.mts`
- Modify: `apps/run.flash/webapp/src/config/meshtastic.ts`
- Test: `apps/run.flash/webapp/src/config/meshtastic.test.ts`

**Interfaces:**
- Produces: `MAX_RINGTONE_LEN: 230`; `RINGTONES: { rabbit; wildhare; og; admin }`; `ringtoneForClass(usertype?: string): string`; `resolveRingtone(user?: { ringtone?: string | null; mqttUsertype?: string | null }): string` (never empty, length-clamped).
- Consumes: nothing new.

- [ ] **Step 1: Add vitest to run.flash**

Add to `apps/run.flash/webapp/package.json` `scripts`:

```json
    "test": "vitest run"
```

Add to `devDependencies` (match run.human's version — confirm with `grep '"vitest"' apps/run.human/webapp/package.json` and use the same):

```json
    "vitest": "^3.2.4"
```

Then install: `cd apps/run.flash/webapp && npm install`

Create `apps/run.flash/webapp/vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/run.flash/webapp/src/config/meshtastic.test.ts
import { describe, it, expect } from "vitest";
import { ringtoneForClass, resolveRingtone, RINGTONES, MAX_RINGTONE_LEN } from "./meshtastic";

describe("ringtoneForClass", () => {
  it("maps each class to its tune", () => {
    expect(ringtoneForClass("rabbit")).toBe(RINGTONES.rabbit);
    expect(ringtoneForClass("wildhare")).toBe(RINGTONES.wildhare);
    expect(ringtoneForClass("og")).toBe(RINGTONES.og);
    expect(ringtoneForClass("admin")).toBe(RINGTONES.admin);
  });
  it("falls back to rabbit for unknown/undefined", () => {
    expect(ringtoneForClass(undefined)).toBe(RINGTONES.rabbit);
    expect(ringtoneForClass("mystery")).toBe(RINGTONES.rabbit);
  });
});

describe("resolveRingtone", () => {
  it("prefers a non-empty per-user ringtone", () => {
    expect(resolveRingtone({ ringtone: "mine:d=8:c", mqttUsertype: "og" })).toBe("mine:d=8:c");
  });
  it("trims the per-user ringtone", () => {
    expect(resolveRingtone({ ringtone: "  mine:d=8:c  " })).toBe("mine:d=8:c");
  });
  it("falls back to class default when ringtone is empty/blank/null", () => {
    expect(resolveRingtone({ ringtone: "   ", mqttUsertype: "wildhare" })).toBe(RINGTONES.wildhare);
    expect(resolveRingtone({ ringtone: null, mqttUsertype: "admin" })).toBe(RINGTONES.admin);
    expect(resolveRingtone({ mqttUsertype: "og" })).toBe(RINGTONES.og);
  });
  it("falls back to rabbit with no info at all", () => {
    expect(resolveRingtone(undefined)).toBe(RINGTONES.rabbit);
    expect(resolveRingtone({})).toBe(RINGTONES.rabbit);
  });
  it("clamps to the length cap", () => {
    const long = "x:d=8:" + "c,".repeat(300);
    expect(resolveRingtone({ ringtone: long }).length).toBeLessThanOrEqual(MAX_RINGTONE_LEN);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/run.flash/webapp && nvm use 23.6.0 && npx vitest run src/config/meshtastic.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 4: Implement in `config/meshtastic.ts`**

Append to `apps/run.flash/webapp/src/config/meshtastic.ts` (after the existing `meshtasticConfig` export):

```ts
/**
 * Ringtone (RTTTL) assignment. Precedence: per-user RunUser.ringtone (set via
 * the run.human admin console) → class default keyed off mqttUsertype → rabbit
 * default. Result is never empty and is clamped to the firmware length cap.
 *
 * Placeholder tunes — swap these strings to change the defaults (one PR).
 */
export const MAX_RINGTONE_LEN = 230;

export const RINGTONES = Object.freeze({
  rabbit: "dcrun:d=8,o=6,b=140:c,e,g,c7",
  wildhare: "hare:d=16,o=6,b=200:c,e,g,c7,g,e,c,e,g,c7",
  og: "og:d=8,o=5,b=110:g,p,g,p,e,p,c,2g",
  admin: "admin:d=8,o=5,b=100:g,g,g,4d#",
});

export function ringtoneForClass(usertype?: string | null): string {
  switch (usertype) {
    case "wildhare":
      return RINGTONES.wildhare;
    case "og":
      return RINGTONES.og;
    case "admin":
      return RINGTONES.admin;
    case "rabbit":
    default:
      return RINGTONES.rabbit;
  }
}

export function resolveRingtone(user?: {
  ringtone?: string | null;
  mqttUsertype?: string | null;
}): string {
  const personal = user?.ringtone?.trim();
  const chosen =
    personal && personal.length > 0
      ? personal
      : ringtoneForClass(user?.mqttUsertype);
  return chosen.slice(0, MAX_RINGTONE_LEN);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/run.flash/webapp && npx vitest run src/config/meshtastic.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/run.flash/webapp/package.json apps/run.flash/webapp/package-lock.json apps/run.flash/webapp/vitest.config.mts apps/run.flash/webapp/src/config/meshtastic.ts apps/run.flash/webapp/src/config/meshtastic.test.ts
git commit -m "feat(flash): ringtone resolution (per-user + class default) + vitest setup"
```

---

## Task 6: Ringtone AdminMessage builder (run.flash)

**Files:**
- Create: `apps/run.flash/webapp/src/lib/ringtone-admin.ts`
- Test: `apps/run.flash/webapp/src/lib/ringtone-admin.test.ts`

**Interfaces:**
- Produces: `buildRingtoneAdminMessageBytes(rtttl: string): Uint8Array` — serialized `AdminMessage` with `setRingtoneMessage`. Pure; imports only `@meshtastic/core` (Protobuf) + `@bufbuild/protobuf`. Deliberately NOT in `lib/meshtastic.ts` (which is `"use client"` and pulls the web-serial transport) so it is unit-testable in Node.

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.flash/webapp/src/lib/ringtone-admin.test.ts
import { describe, it, expect } from "vitest";
import { Protobuf } from "@meshtastic/core";
import { fromBinary } from "@bufbuild/protobuf";
import { buildRingtoneAdminMessageBytes } from "./ringtone-admin";

describe("buildRingtoneAdminMessageBytes", () => {
  it("encodes an AdminMessage carrying the RTTTL as setRingtoneMessage", () => {
    const tune = "og:d=8,o=5,b=110:g,p,g,p,e,p,c,2g";
    const bytes = buildRingtoneAdminMessageBytes(tune);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const decoded = fromBinary(Protobuf.Admin.AdminMessageSchema, bytes);
    expect(decoded.payloadVariant.case).toBe("setRingtoneMessage");
    expect(decoded.payloadVariant.value).toBe(tune);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.flash/webapp && npx vitest run src/lib/ringtone-admin.test.ts`
Expected: FAIL — `Cannot find module './ringtone-admin'`.

(If `@meshtastic/core` fails to import under Node/vitest, the module is pure protobuf and should import cleanly; do NOT mock it — investigate the actual import error instead.)

- [ ] **Step 3: Implement**

```ts
// apps/run.flash/webapp/src/lib/ringtone-admin.ts
/**
 * Build the serialized Meshtastic AdminMessage that sets the device ringtone
 * (RTTTL). @meshtastic/core exposes no setRingtone() helper, so we mirror its
 * own setCannedMessages pattern: create an AdminMessage with the
 * setRingtoneMessage variant and serialize it. The caller sends the bytes on
 * the ADMIN_APP port via device.sendPacket(bytes, PortNum.ADMIN_APP, "self").
 *
 * Kept OUT of lib/meshtastic.ts (a "use client" module that imports the
 * web-serial transport) so this stays pure + unit-testable in Node.
 */
import { Protobuf } from "@meshtastic/core";
import { create, toBinary } from "@bufbuild/protobuf";

export function buildRingtoneAdminMessageBytes(rtttl: string): Uint8Array {
  const msg = create(Protobuf.Admin.AdminMessageSchema, {
    payloadVariant: { case: "setRingtoneMessage", value: rtttl },
  });
  return toBinary(Protobuf.Admin.AdminMessageSchema, msg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.flash/webapp && npx vitest run src/lib/ringtone-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.flash/webapp/src/lib/ringtone-admin.ts apps/run.flash/webapp/src/lib/ringtone-admin.test.ts
git commit -m "feat(flash): AdminMessage builder for setting device ringtone"
```

---

## Task 7: Wire ringtone into payload, config route, and device push (run.flash)

**Files:**
- Modify: `apps/run.flash/webapp/src/types/config.ts` (`DeviceConfigPayload`, `ConfigStage`)
- Modify: `apps/run.flash/webapp/src/app/api/config/route.ts`
- Modify: `apps/run.flash/webapp/src/lib/meshtastic.ts` (`pushDeviceConfig`)
- Modify: `apps/run.flash/webapp/src/hooks/use-configure.ts` (`stages` array)
- Modify: `apps/run.flash/webapp/src/components/configure/config-pipeline.tsx` (display stages)

**Interfaces:**
- Consumes: `resolveRingtone` (Task 5), `buildRingtoneAdminMessageBytes` (Task 6).
- Produces: `DeviceConfigPayload.ringtone: string`; a new `"ringtone"` `ConfigStage`; ringtone pushed after identity, before commit.

- [ ] **Step 1: Extend the payload + stage types**

In `src/types/config.ts`, add `ringtone` to `DeviceConfigPayload`:

```ts
export interface DeviceConfigPayload {
  mqtt: MqttConfig;
  channels: ChannelConfig[];
  identity: IdentityConfig;
  radio: RadioConfig;
  ringtone: string; // RTTTL tune (resolved: per-user override or class default)
}
```

And add `"ringtone"` to the `ConfigStage` union (after `"identity"`, before `"committing"`):

```ts
  | "identity" // Pushing identity config
  | "ringtone" // Pushing RTTTL ringtone
  | "committing" // commitEditSettings
```

- [ ] **Step 2: Resolve + include ringtone in `/api/config`**

In `src/app/api/config/route.ts`, add the import:

```ts
import { meshtasticConfig, resolveRingtone } from "@/config/meshtastic";
```

(replace the existing `import { meshtasticConfig } from "@/config/meshtastic";`).

In the dev stub, add a `mqttUsertype`/`ringtone` so dev still resolves — change the stub user to:

```ts
      user = { displayName: null, mqttUsername: "dev_user", mqttPassword: "dev_pass", mqttUsertype: "rabbit", ringtone: null };
```

Before building `payload`, compute:

```ts
    const ringtone = resolveRingtone({
      ringtone: user?.ringtone,
      mqttUsertype: user?.mqttUsertype,
    });
```

Add `ringtone` to the `payload` object:

```ts
    const payload: DeviceConfigPayload = {
      mqtt: { /* unchanged */ },
      channels: meshtasticConfig.channels,
      identity: { longName, shortName },
      radio: meshtasticConfig.radio,
      ringtone,
    };
```

- [ ] **Step 3: Push the ringtone stage in `pushDeviceConfig`**

In `src/lib/meshtastic.ts`, add the import at the top (with the other imports):

```ts
import { buildRingtoneAdminMessageBytes } from "@/lib/ringtone-admin";
```

In `pushDeviceConfig`, between the Identity block (`onStageComplete("identity", ...)`) and the Commit block (`// 5. Commit all changes atomically`), insert:

```ts
  // 4b. Ringtone (RTTTL) — set via AdminMessage on the ADMIN_APP port.
  // @meshtastic/core has no setRingtone() helper; mirror its setCannedMessages
  // pattern (AdminMessage → sendPacket to ADMIN_APP "self"). Sets the tune only;
  // enabling the External Notification buzzer module is out of scope.
  console.log("[meshtastic] Pushing ringtone...");
  const ringtoneBytes = buildRingtoneAdminMessageBytes(config.ringtone);
  await device.sendPacket(
    ringtoneBytes,
    Protobuf.Portnums.PortNum.ADMIN_APP,
    "self"
  );
  console.log("[meshtastic] Ringtone applied");
  onStageComplete("ringtone", "custom tune");
```

- [ ] **Step 4: Add `"ringtone"` to the hook's stage progression**

In `src/hooks/use-configure.ts`, update the `stages` array to insert `"ringtone"` before `"committing"`:

```ts
        const stages: ConfigStage[] = [
          "radio",
          "mqtt",
          "channels",
          "identity",
          "ringtone",
          "committing",
        ];
```

- [ ] **Step 5: Add the Ringtone display stage to the pipeline UI**

In `src/components/configure/config-pipeline.tsx`, import a bell icon (add `Bell` to the existing `lucide-react` import). Change the `identity` display stage so it no longer folds in `"committing"`, and add a `ringtone` display stage that does:

Replace the `identity` display-stage object's `activeStages`/`completeStages` with:

```ts
    activeStages: ["identity"],
    completeStages: ["identity"],
```

Then append after the `identity` object (still inside the `DISPLAY_STAGES` array):

```ts
  {
    key: "ringtone",
    icon: Bell,
    label: "Ringtone",
    activeLabel: "Setting ringtone...",
    completeLabel: () => "Ringtone: set",
    activeStages: ["ringtone", "committing"],
    completeStages: ["ringtone", "committing"],
  },
```

- [ ] **Step 6: Typecheck + build + lint**

Run: `cd apps/run.flash/webapp && npx tsc --noEmit && npx eslint src/lib/meshtastic.ts src/app/api/config/route.ts src/hooks/use-configure.ts src/components/configure/config-pipeline.tsx`
Expected: no new errors.

- [ ] **Step 7: Run the full run.flash test suite**

Run: `cd apps/run.flash/webapp && npx vitest run`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/run.flash/webapp/src/types/config.ts apps/run.flash/webapp/src/app/api/config/route.ts apps/run.flash/webapp/src/lib/meshtastic.ts apps/run.flash/webapp/src/hooks/use-configure.ts apps/run.flash/webapp/src/components/configure/config-pipeline.tsx
git commit -m "feat(flash): push resolved ringtone to device in config pipeline"
```

---

## Task 8: Full verification (both apps)

**Files:** none (verification only)

- [ ] **Step 1: run.human full test suite**

Run: `cd apps/run.human/webapp && nvm use 23.6.0 && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 2: run.flash full test + build + offline invariant**

Run:
```bash
cd apps/run.flash/webapp && npx vitest run && npx tsc --noEmit && npm run build
grep -rE 'api\.meshtastic\.org|github\.com/meshtastic' .next/standalone .next/static || echo "OFFLINE OK"
```
Expected: tests + build PASS; grep prints `OFFLINE OK` (no upstream hosts).

- [ ] **Step 3: Commit any build-config fallout (if any) and finish**

```bash
git status   # expect clean (or commit incidental lockfile/build changes)
```

---

## Self-Review

**Spec coverage:**
- Data model `ringtone` field → Task 2. ✓
- Admin setter (PATCH + drawer) → Tasks 3, 4. ✓
- Internal API exposure → Task 2. ✓
- `ringtoneForClass` + `/api/config` precedence + clamp → Tasks 5, 7. ✓
- `pushDeviceConfig` ringtone stage (AdminMessage → ADMIN_APP) → Tasks 6, 7. ✓
- Validation (client + server) → Task 1 (reused in 3, 4). ✓
- Tests across both apps → Tasks 1, 3, 5, 6, 8. ✓
- Out-of-scope (buzzer enable, upload UI) → not implemented, noted in code comments. ✓

**Placeholder scan:** none — all steps carry real code/commands.

**Type consistency:** `ringtone` string throughout; `resolveRingtone`/`ringtoneForClass`/`buildRingtoneAdminMessageBytes`/`validateRingtone` names consistent across tasks; `ConfigStage` "ringtone" added in types (Task 7) and consumed in hook + pipeline (Task 7); `DeviceConfigPayload.ringtone` produced in Task 7 and read by Task 7's `pushDeviceConfig`. ✓
