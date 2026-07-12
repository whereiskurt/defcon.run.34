# QR Sheet Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-gated `/admin/qr/sheet` designer in run.human that renders styled QR codes (shapes, eyes, center logo, DC34 presets) client-side and downloads a US-Letter PDF sheet (grid or Avery layouts, optional proof pages), gated by a new `qradmin` group scoped to `/admin/qr`.

**Architecture:** All new code in `apps/run.human/webapp`. Pure layout/style modules (`templates.ts`, `styles.ts`) are node-testable; browser-only rendering (`render.ts` via `qr-code-styling`) is injected into the PDF composer (`pdf.ts`, `pdf-lib`) so the composer stays importable in tests. One new client dependency: `qr-code-styling`. No new API routes, no DB writes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4 (HeroUI semantic tokens via `cls` in `qr-ui.ts`), `qr-code-styling` (new), `pdf-lib` (already a dep), `qrcode` (already a dep, used only for error-correction capacity picking), vitest.

**Spec:** `docs/superpowers/specs/2026-07-12-qr-sheet-designer-design.md`

## Global Constraints

- Working dir for all commands: `apps/run.human/webapp` inside the worktree `/Users/khundeck/working/defcon.run.34/.claude/worktrees/qrsheet`.
- Branch: `feat/qr-sheet-designer` (already created; spec committed).
- Vitest needs Node ≥ 22.12 on this host: run `nvm use 23.6.0` in the shell before any `npx vitest` (default node fails to start — looks like a test failure but is environmental).
- Admin denial is ALWAYS a 404 (`notFound()` on pages, bodiless 404 on API) — never 401/403.
- `/admin` root behavior must stay byte-identical: `qradmin` unlocks only `/admin/qr/**` and `/api/admin/qr`.
- PDF page: US Letter, 612×792 pt (72 pt/inch). QR drawn at 90% of its cell box.
- Custom grid axes bounded to 1–12.
- Logo forces error-correction floor Q (target H); logo size 22% of QR width.
- All UI classes come from `cls` in `src/components/admin/qr-ui.ts` — do not invent new visual language.
- Commit after every task (each task ends with a commit step). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `qradmin` group gating

**Files:**
- Modify: `src/lib/admin-gate.ts`
- Modify: `src/config/auth.ts` (revalidateAdmin block, ~lines 114–123)
- Modify: `src/app/(protected)/admin/qr/gate.ts`
- Modify: `src/app/api/admin/qr/route.ts` (gate lines 47–50)
- Test: `src/lib/__tests__/admin-gate.test.ts` (new)

**Interfaces:**
- Consumes: existing `SessionLike`, `RequireAdminResult`, `fetchFreshClaims` (private in `config/auth.ts`).
- Produces: `QR_ADMIN_GROUPS: readonly string[]`, `isMemberOf(session, groups)`, `requireGroups(session, groups): RequireAdminResult` (all from `@/lib/admin-gate`), `revalidateGroups(userId, groups): Promise<boolean>` (from `@/config/auth`, re-exported by `@/lib/admin-gate`). Task 6's page gate uses `gateAdminPage()` unchanged in signature.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/admin-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ADMIN_GROUPS,
  QR_ADMIN_GROUPS,
  isMemberOf,
  requireGroups,
  isAdmin,
  requireAdmin,
} from "../admin-gate";

const sess = (services: string[] | null) =>
  ({ user: { services, email: "x@y.z" } }) as never;

describe("QR_ADMIN_GROUPS", () => {
  it("is ADMIN_GROUPS plus qradmin", () => {
    expect([...QR_ADMIN_GROUPS]).toEqual([...ADMIN_GROUPS, "qradmin"]);
  });
});

describe("isMemberOf / requireGroups", () => {
  it("admits qradmin on QR groups but NOT on admin groups", () => {
    const s = sess(["qradmin"]);
    expect(isMemberOf(s, QR_ADMIN_GROUPS)).toBe(true);
    expect(requireGroups(s, QR_ADMIN_GROUPS)).toEqual({ ok: true, email: "x@y.z" });
    expect(isAdmin(s)).toBe(false);
    expect(requireAdmin(s).ok).toBe(false);
  });

  it("admits admin and runadmin on both group lists", () => {
    for (const g of ["admin", "runadmin"]) {
      expect(isMemberOf(sess([g]), ADMIN_GROUPS)).toBe(true);
      expect(isMemberOf(sess([g]), QR_ADMIN_GROUPS)).toBe(true);
    }
  });

  it("denies empty/absent services and missing session", () => {
    expect(requireGroups(sess([]), QR_ADMIN_GROUPS)).toEqual({
      ok: false,
      reason: "not_admin",
    });
    expect(requireGroups(sess(null), QR_ADMIN_GROUPS).ok).toBe(false);
    expect(requireGroups(null, QR_ADMIN_GROUPS)).toEqual({
      ok: false,
      reason: "no_session",
    });
  });

  it("existing requireAdmin behavior is unchanged (wrapper)", () => {
    expect(requireAdmin(sess(["admin"]))).toEqual({ ok: true, email: "x@y.z" });
    expect(requireAdmin(sess(["qradmin", "somethingelse"])).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
nvm use 23.6.0 && npx vitest run src/lib/__tests__/admin-gate.test.ts
```
Expected: FAIL — `QR_ADMIN_GROUPS`, `isMemberOf`, `requireGroups` not exported.

- [ ] **Step 3: Implement gate changes**

In `src/lib/admin-gate.ts` — add after `ADMIN_GROUPS` (keep doc comments in the file's voice; update the module header note to mention the QR-scoped variant):

```ts
/**
 * Groups that grant access to the /admin/qr surface ONLY. Superset of
 * ADMIN_GROUPS: `qradmin` members are QR operators — they get the whole
 * /admin/qr area (codes, ctf, sheet designer, /api/admin/qr) but NOT /admin
 * root or any other admin surface.
 */
export const QR_ADMIN_GROUPS = [...ADMIN_GROUPS, "qradmin"] as const;

/** True iff the session carries ANY of `groups` on its services list. */
export function isMemberOf(
  session: SessionLike,
  groups: readonly string[]
): boolean {
  const services = session?.user?.services;
  return Array.isArray(services) && services.some((s) => groups.includes(s));
}

/** Group-parameterized twin of requireAdmin — same result contract. */
export function requireGroups(
  session: SessionLike,
  groups: readonly string[]
): RequireAdminResult {
  if (!session?.user) {
    return { ok: false, reason: "no_session" };
  }
  if (!isMemberOf(session, groups)) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, email: session.user.email ?? null };
}
```

Rewrite `isAdmin`/`requireAdmin` as wrappers (delete their old bodies):

```ts
export function isAdmin(session: SessionLike): boolean {
  return isMemberOf(session, ADMIN_GROUPS);
}

export function requireAdmin(session: SessionLike): RequireAdminResult {
  return requireGroups(session, ADMIN_GROUPS);
}
```

Change the re-export line at the top to also surface the new revalidator:

```ts
export { revalidateAdmin, revalidateGroups } from "@/config/auth";
```

In `src/config/auth.ts`, replace the `revalidateAdmin` function (~lines 114–123) with:

```ts
/**
 * Group-parameterized live re-check: fetch fresh claims from run.auth and
 * grant iff the user holds ANY of `groups` and is not locked out. Fail-closed.
 * (Group lists live in lib/admin-gate.ts — passed in to avoid an import cycle;
 * admin-gate imports from this module.)
 */
export async function revalidateGroups(
  userId: string,
  groups: readonly string[]
): Promise<boolean> {
  const fresh = await fetchFreshClaims(userId);
  const services = fresh?.services;
  const hasGroup =
    Array.isArray(services) && services.some((s) => groups.includes(s));
  return hasGroup && !fresh?.lockedOut;
}

export async function revalidateAdmin(userId: string): Promise<boolean> {
  // Keep in lock-step with ADMIN_GROUPS in lib/admin-gate.ts.
  return revalidateGroups(userId, ["admin", "runadmin"]);
}
```

In `src/app/(protected)/admin/qr/gate.ts`, switch to the QR group list (update the doc comment to say the gate admits admin/runadmin/qradmin):

```ts
import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import {
  QR_ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";

export async function gateAdminPage(): Promise<{ email: string | null }> {
  const session = await auth();
  const gate = requireGroups(session, QR_ADMIN_GROUPS);
  if (!gate.ok) notFound();

  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, QR_ADMIN_GROUPS)))
    notFound();

  return { email: gate.email };
}
```

In `src/app/api/admin/qr/route.ts`, replace the two gate lines (47–50) and the import:

```ts
import {
  QR_ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";
```
```ts
  const session = await auth();
  if (!requireGroups(session, QR_ADMIN_GROUPS).ok) return notFound();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, QR_ADMIN_GROUPS)))
    return notFound();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
nvm use 23.6.0 && npx vitest run src/lib/__tests__/admin-gate.test.ts src/lib/__tests__/qr-admin.test.ts
```
Expected: PASS (both files — qr-admin.test.ts proves no regression).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-gate.ts src/config/auth.ts "src/app/(protected)/admin/qr/gate.ts" src/app/api/admin/qr/route.ts src/lib/__tests__/admin-gate.test.ts
git commit -m "feat(qr): qradmin group unlocks /admin/qr surfaces only"
```

---

### Task 2: Sheet layout templates (`templates.ts`)

**Files:**
- Create: `src/components/admin/qr-sheet/templates.ts`
- Test: `src/components/admin/qr-sheet/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces:
  - `DPI = 72`, `PAGE_WIDTH = 612`, `PAGE_HEIGHT = 792`
  - `type SheetLayout = { kind: "grid" | "avery"; name: string; across: number; down: number; cellW: number; cellH: number; qrBox: number; startX: number; startY: number; pitchX: number; pitchY: number; widthIn: number; heightIn: number }`
  - `AVERY_TEMPLATES: Record<string, {...}>` (dc33 data, verbatim)
  - `parseTemplate(input: string): SheetLayout | null`
  - `cellOrigin(layout: SheetLayout, dx: number, dy: number): { x: number; y: number }` (bottom-left of cell in PDF coords)
  - `GRID_PRESETS: { label: string; value: string }[]` and `AVERY_INFO: { id: string; desc: string; dims: string }[]` (UI data)

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/qr-sheet/__tests__/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseTemplate,
  cellOrigin,
  PAGE_WIDTH,
  PAGE_HEIGHT,
} from "../templates";

describe("parseTemplate — grids", () => {
  it("parses 4x6 with dc33 box math (square boxes, centered)", () => {
    const l = parseTemplate("4x6")!;
    expect(l.kind).toBe("grid");
    expect(l.across).toBe(4);
    expect(l.down).toBe(6);
    // dc33: gridW=612-40=572, gridH=792-80=712 → box=min(143, 118.666…)
    expect(l.qrBox).toBeCloseTo(712 / 6, 5);
    expect(l.cellW).toBeCloseTo(l.qrBox, 5);
    expect(l.pitchX).toBeCloseTo(l.qrBox, 5);
    // centered: startX=(612-4*box)/2 ; startY=792-(792-6*box)/2-box
    expect(l.startX).toBeCloseTo((PAGE_WIDTH - 4 * l.qrBox) / 2, 5);
    expect(l.startY).toBeCloseTo(
      PAGE_HEIGHT - (PAGE_HEIGHT - 6 * l.qrBox) / 2 - l.qrBox,
      5
    );
  });

  it("defaults 7x9 for empty input", () => {
    const l = parseTemplate("")!;
    expect(l.across).toBe(7);
    expect(l.down).toBe(9);
  });

  it("rejects out-of-bounds and garbage", () => {
    expect(parseTemplate("0x9")).toBeNull();
    expect(parseTemplate("13x4")).toBeNull();
    expect(parseTemplate("4x13")).toBeNull();
    expect(parseTemplate("hello")).toBeNull();
    expect(parseTemplate("4x")).toBeNull();
  });
});

describe("parseTemplate — Avery", () => {
  it("parses 5160 with exact label geometry (accepts avery- prefix)", () => {
    for (const input of ["5160", "avery-5160"]) {
      const l = parseTemplate(input)!;
      expect(l.kind).toBe("avery");
      expect(l.name).toBe("avery-5160");
      expect(l.across).toBe(3);
      expect(l.down).toBe(10);
      expect(l.cellW).toBeCloseTo(2.625 * 72, 5);
      expect(l.cellH).toBeCloseTo(1 * 72, 5);
      expect(l.qrBox).toBeCloseTo(72, 5); // min(w,h)
      expect(l.startX).toBeCloseTo(0.1875 * 72, 5);
      expect(l.startY).toBeCloseTo(792 - 0.5 * 72 - 72, 5);
      expect(l.pitchX).toBeCloseTo(2.625 * 72 + 0.125 * 72, 5);
      expect(l.pitchY).toBeCloseTo(72 + 0, 5);
      expect(l.widthIn).toBe(2.625);
      expect(l.heightIn).toBe(1);
    }
  });

  it("rejects unknown Avery ids", () => {
    expect(parseTemplate("9999")).toBeNull();
  });
});

describe("cellOrigin", () => {
  it("steps by pitch from start, y downward", () => {
    const l = parseTemplate("5160")!;
    expect(cellOrigin(l, 0, 0)).toEqual({ x: l.startX, y: l.startY });
    expect(cellOrigin(l, 2, 3).x).toBeCloseTo(l.startX + 2 * l.pitchX, 5);
    expect(cellOrigin(l, 2, 3).y).toBeCloseTo(l.startY - 3 * l.pitchY, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/templates.test.ts
```
Expected: FAIL — cannot resolve `../templates`.

- [ ] **Step 3: Implement `templates.ts`**

```ts
/**
 * Pure sheet-layout math for the QR sheet designer — ported from dc33's
 * /api/qr/sheet route (defcon.run.33). No DOM, no deps: unit-tested in node.
 * All linear units are PDF points (72/inch); page is US Letter.
 */

export const DPI = 72;
export const PAGE_WIDTH = 8.5 * DPI; // 612
export const PAGE_HEIGHT = 11 * DPI; // 792

// dc33 grid margins: 40pt total X, 80pt total Y (header/footer room).
const TOTAL_MARGIN_X = 40;
const TOTAL_MARGIN_Y = 80;

const MAX_AXIS = 12; // practical print floor — beyond this cells scan poorly

/** Avery label geometry (inches) — dc33 data, verbatim. */
export const AVERY_TEMPLATES: Record<
  string,
  {
    across: number;
    down: number;
    width: number;
    height: number;
    marginLeft: number;
    marginTop: number;
    spacingX: number;
    spacingY: number;
  }
> = {
  "5160": { across: 3, down: 10, width: 2.625, height: 1, marginLeft: 0.1875, marginTop: 0.5, spacingX: 0.125, spacingY: 0 },
  "5163": { across: 2, down: 5, width: 4, height: 2, marginLeft: 0.25, marginTop: 0.5, spacingX: 0.25, spacingY: 0 },
  "5164": { across: 2, down: 3, width: 4, height: 3.33, marginLeft: 0.25, marginTop: 0.17, spacingX: 0.25, spacingY: 0 },
  "5167": { across: 4, down: 20, width: 1.75, height: 0.5, marginLeft: 0.3125, marginTop: 0.5, spacingX: 0.1875, spacingY: 0 },
  "5261": { across: 2, down: 10, width: 4, height: 1, marginLeft: 0.25, marginTop: 0.5, spacingX: 0.25, spacingY: 0 },
  "5262": { across: 2, down: 7, width: 4, height: 1.33, marginLeft: 0.25, marginTop: 0.17, spacingX: 0.25, spacingY: 0.17 },
  "8160": { across: 3, down: 10, width: 2.625, height: 1, marginLeft: 0.1875, marginTop: 0.5, spacingX: 0.125, spacingY: 0 },
  "22816": { across: 3, down: 6, width: 2.5, height: 2.5, marginLeft: 0.25, marginTop: 0.5, spacingX: 0.25, spacingY: 0.25 },
};

export type SheetLayout = {
  kind: "grid" | "avery";
  /** Canonical name for filenames/UI: "4x6" or "avery-5160". */
  name: string;
  across: number;
  down: number;
  /** Cell size in points (grid: cellW === cellH === qrBox). */
  cellW: number;
  cellH: number;
  /** The square box a QR fits in: min(cellW, cellH). */
  qrBox: number;
  /** Bottom-left of the TOP-LEFT cell, PDF coords (y up). */
  startX: number;
  startY: number;
  /** Step between cell origins (cell + label spacing). */
  pitchX: number;
  pitchY: number;
  /** Physical cell size in inches (for filenames / UI). */
  widthIn: number;
  heightIn: number;
};

/**
 * Parse a template string: "" → default 7x9 grid, "AxB" → custom grid
 * (1–12 per axis), "5160" / "avery-5160" → Avery. Anything else → null.
 */
export function parseTemplate(input: string): SheetLayout | null {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (trimmed === "") return gridLayout(7, 9);

  const averyMatch = trimmed.match(/^(?:avery-)?(\d{4,5})$/);
  if (averyMatch) {
    const t = AVERY_TEMPLATES[averyMatch[1]];
    if (!t) return null;
    return {
      kind: "avery",
      name: `avery-${averyMatch[1]}`,
      across: t.across,
      down: t.down,
      cellW: t.width * DPI,
      cellH: t.height * DPI,
      qrBox: Math.min(t.width, t.height) * DPI,
      startX: t.marginLeft * DPI,
      startY: PAGE_HEIGHT - t.marginTop * DPI - t.height * DPI,
      pitchX: (t.width + t.spacingX) * DPI,
      pitchY: (t.height + t.spacingY) * DPI,
      widthIn: t.width,
      heightIn: t.height,
    };
  }

  const gridMatch = trimmed.match(/^(\d{1,2})x(\d{1,2})$/);
  if (gridMatch) {
    const across = parseInt(gridMatch[1], 10);
    const down = parseInt(gridMatch[2], 10);
    if (across < 1 || down < 1 || across > MAX_AXIS || down > MAX_AXIS)
      return null;
    return gridLayout(across, down);
  }

  return null;
}

function gridLayout(across: number, down: number): SheetLayout {
  // dc33: square boxes sized to the tighter axis, grid centered on the page.
  const box = Math.min(
    (PAGE_WIDTH - TOTAL_MARGIN_X) / across,
    (PAGE_HEIGHT - TOTAL_MARGIN_Y) / down
  );
  return {
    kind: "grid",
    name: `${across}x${down}`,
    across,
    down,
    cellW: box,
    cellH: box,
    qrBox: box,
    startX: (PAGE_WIDTH - box * across) / 2,
    startY: PAGE_HEIGHT - (PAGE_HEIGHT - box * down) / 2 - box,
    pitchX: box,
    pitchY: box,
    widthIn: box / DPI,
    heightIn: box / DPI,
  };
}

/** Bottom-left corner of cell (dx, dy); dy counts DOWN from the top row. */
export function cellOrigin(
  layout: SheetLayout,
  dx: number,
  dy: number
): { x: number; y: number } {
  return { x: layout.startX + dx * layout.pitchX, y: layout.startY - dy * layout.pitchY };
}

/** dc33's six layout preset buttons. */
export const GRID_PRESETS = [
  { label: "Default (7×9)", value: "7x9" },
  { label: "Large (3×3)", value: "3x3" },
  { label: "Medium (4×6)", value: "4x6" },
  { label: "Small (6×8)", value: "6x8" },
  { label: "Avery 5160", value: "5160" },
  { label: "Avery 22816", value: "22816" },
] as const;

/** Avery reference data for the layout dropdown (replaces dc33's cards). */
export const AVERY_INFO = [
  { id: "5160", desc: "Address labels", dims: '2.625" × 1", 3×10' },
  { id: "5163", desc: "Shipping labels", dims: '4" × 2", 2×5' },
  { id: "5164", desc: "Shipping labels", dims: '4" × 3.33", 2×3' },
  { id: "5167", desc: "Return address", dims: '1.75" × 0.5", 4×20' },
  { id: "5261", desc: "Address labels", dims: '4" × 1", 2×10' },
  { id: "5262", desc: "Address labels", dims: '4" × 1.33", 2×7' },
  { id: "8160", desc: "Address labels", dims: '2.625" × 1", 3×10' },
  { id: "22816", desc: "Square labels", dims: '2.5" × 2.5", 3×6' },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/templates.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/qr-sheet/
git commit -m "feat(qr): sheet layout math ported from dc33 (grids + Avery)"
```

---

### Task 3: Styles, DC34 presets, contrast check + logo assets

**Files:**
- Create: `src/components/admin/qr-sheet/styles.ts`
- Create: `public/qr-logos/dcjack.svg`, `public/qr-logos/meshtastic.svg`, `public/qr-logos/dc34.png` (copies of existing repo art)
- Modify: `docs/superpowers/specs/2026-07-12-qr-sheet-designer-design.md` (preset/logo reality note)
- Test: `src/components/admin/qr-sheet/__tests__/styles.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `type ModuleShape = "square" | "dots" | "rounded" | "classy"`
  - `type EyeShape = "square" | "rounded" | "dot"`
  - `type QrStyle = { moduleShape: ModuleShape; moduleColor: string; background: string; eyeShape: EyeShape; eyeColor: string; logo?: string }` (`logo` = app-relative path or data URL; absent = none)
  - `DC34_PRESETS: { id: string; label: string; style: QrStyle }[]`
  - `BUNDLED_LOGOS: { id: string; label: string; path: string }[]`
  - `relativeLuminance(hex: string): number`
  - `contrastWarning(style: QrStyle): string | null`
  - `LOGO_SIZE_RATIO = 0.22`

- [ ] **Step 1: Copy the logo assets** (from repo root; dcjack already in run.human but consolidate under one dir)

```bash
mkdir -p public/qr-logos
cp public/header/dcjack.svg public/qr-logos/dcjack.svg
cp ../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/meshtastic.svg public/qr-logos/meshtastic.svg
cp ../../../infra/terraform/modules/cloudfront-redirect/v1.0.0/assets/dc34.png public/qr-logos/dc34.png
```

- [ ] **Step 2: Write the failing test**

Create `src/components/admin/qr-sheet/__tests__/styles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DC34_PRESETS,
  BUNDLED_LOGOS,
  relativeLuminance,
  contrastWarning,
  type QrStyle,
} from "../styles";

describe("relativeLuminance", () => {
  it("black=0, white=1, dark teal is dark", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#12836f")).toBeLessThan(0.25);
  });
});

describe("contrastWarning", () => {
  const base: QrStyle = {
    moduleShape: "square",
    moduleColor: "#000000",
    background: "#ffffff",
    eyeShape: "square",
    eyeColor: "#000000",
  };
  it("silent for black-on-white", () => {
    expect(contrastWarning(base)).toBeNull();
  });
  it("warns on light modules and inverted schemes", () => {
    expect(contrastWarning({ ...base, moduleColor: "#2fe3c6" })).toBeTruthy();
    expect(
      contrastWarning({ ...base, moduleColor: "#ffffff", background: "#000000" })
    ).toBeTruthy();
  });
  it("warns on light eyes even if modules are fine", () => {
    expect(contrastWarning({ ...base, eyeColor: "#ffe6f3" })).toBeTruthy();
  });
});

describe("DC34_PRESETS", () => {
  it("every preset is scannable: dark marks on light background", () => {
    for (const p of DC34_PRESETS) {
      expect(contrastWarning(p.style), p.id).toBeNull();
    }
  });
  it("includes classic as the first preset, no logo", () => {
    expect(DC34_PRESETS[0].id).toBe("classic");
    expect(DC34_PRESETS[0].style.logo).toBeUndefined();
  });
  it("preset logos reference bundled files", () => {
    const paths = BUNDLED_LOGOS.map((l) => l.path);
    for (const p of DC34_PRESETS) {
      if (p.style.logo) expect(paths).toContain(p.style.logo);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/styles.test.ts
```
Expected: FAIL — cannot resolve `../styles`.

- [ ] **Step 4: Implement `styles.ts`**

```ts
/**
 * QR visual style model + DC34 presets for the sheet designer. Pure data —
 * shape values are OUR vocabulary; render.ts maps them onto qr-code-styling's
 * type names. Preset palette hexes come from the Run Hacker Run interstitial
 * (infra cloudfront-redirect assets): dark teal #12836f, deep magenta #8f1857.
 */

export type ModuleShape = "square" | "dots" | "rounded" | "classy";
export type EyeShape = "square" | "rounded" | "dot";

export type QrStyle = {
  moduleShape: ModuleShape;
  moduleColor: string;
  background: string;
  eyeShape: EyeShape;
  eyeColor: string;
  /** App-relative path (bundled) or data URL (upload). Absent = no logo. */
  logo?: string;
};

/** Center logo caps at 22% of QR width — keeps codes scannable at EC ≥ Q. */
export const LOGO_SIZE_RATIO = 0.22;

export const BUNDLED_LOGOS = [
  { id: "dcjack", label: "DC Jack", path: "/qr-logos/dcjack.svg" },
  { id: "mesh", label: "Meshtastic", path: "/qr-logos/meshtastic.svg" },
  { id: "dc34", label: "DC34", path: "/qr-logos/dc34.png" },
] as const;

export const DC34_PRESETS: { id: string; label: string; style: QrStyle }[] = [
  {
    id: "classic",
    label: "Classic",
    style: {
      moduleShape: "square",
      moduleColor: "#000000",
      background: "#ffffff",
      eyeShape: "square",
      eyeColor: "#000000",
    },
  },
  {
    id: "run-hacker-run",
    label: "Run Hacker Run",
    style: {
      moduleShape: "rounded",
      moduleColor: "#12836f",
      background: "#ffffff",
      eyeShape: "rounded",
      eyeColor: "#8f1857",
      logo: "/qr-logos/dc34.png",
    },
  },
  {
    id: "mesh",
    label: "Mesh",
    style: {
      moduleShape: "dots",
      moduleColor: "#000000",
      background: "#ffffff",
      eyeShape: "rounded",
      eyeColor: "#12836f",
      logo: "/qr-logos/meshtastic.svg",
    },
  },
  {
    id: "stealth",
    label: "Stealth",
    style: {
      moduleShape: "classy",
      moduleColor: "#111827",
      background: "#ffffff",
      eyeShape: "square",
      eyeColor: "#111827",
      logo: "/qr-logos/dcjack.svg",
    },
  },
];

/** WCAG relative luminance of a #rrggbb (or #rgb) hex, 0 (black) – 1 (white). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Non-blocking scannability heuristic: scanners want DARK marks on a LIGHT
 * background. Warn when the background isn't clearly lighter than both the
 * modules and the eyes (luminance gap < 0.4) — covers light-on-light AND
 * inverted schemes.
 */
export function contrastWarning(style: QrStyle): string | null {
  const bg = relativeLuminance(style.background);
  const gapModules = bg - relativeLuminance(style.moduleColor);
  const gapEyes = bg - relativeLuminance(style.eyeColor);
  if (gapModules < 0.4 || gapEyes < 0.4) {
    return "Low contrast: scanners want dark modules and eyes on a light background — this combination may not scan reliably.";
  }
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/styles.test.ts
```
Expected: PASS.

- [ ] **Step 6: Note the logo reality in the spec**

In `docs/superpowers/specs/2026-07-12-qr-sheet-designer-design.md`, in the Designer UI section, change the center-logo sentence from "bundled DC34 marks (skull badge, dcjack, bunny — sourced from existing repo art, bundled under `public/`)" to:

```
  - Center logo: none / bundled DC34 marks (dcjack, meshtastic, dc34 —
    the marks that exist as usable repo art; no standalone skull asset
    exists and bunny-head.png has an opaque background) / file upload.
```
And in the presets list change "*Run Hacker Run* — dark-teal modules, magenta eyes, skull badge logo" to "*Run Hacker Run* — dark-teal `#12836f` modules, deep-magenta `#8f1857` eyes, DC34 mark logo".

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/qr-sheet/ public/qr-logos/ ../../../docs/superpowers/specs/2026-07-12-qr-sheet-designer-design.md
git commit -m "feat(qr): DC34 QR style presets, contrast heuristic, bundled logo marks"
```

---

### Task 4: Styled QR renderer (`render.ts`) + `qr-code-styling` dependency

**Files:**
- Modify: `package.json` (via `npm i qr-code-styling`)
- Create: `src/components/admin/qr-sheet/render.ts`
- Test: `src/components/admin/qr-sheet/__tests__/render.test.ts` (covers `pickEcLevel` only — the canvas path is browser-only)

**Interfaces:**
- Consumes: `QrStyle`, `LOGO_SIZE_RATIO` from `./styles`; `qrcode` (capacity probe); `qr-code-styling` (dynamic import, browser only).
- Produces:
  - `pickEcLevel(url: string, hasLogo: boolean): "H" | "Q" | "M" | "L"` — throws `Error("URL too long for a QR code")` when nothing fits.
  - `renderQrPng(url: string, style: QrStyle, sizePx: number): Promise<ArrayBuffer>` — browser-only; throws if qr-code-styling returns no data.

- [ ] **Step 1: Install the dependency**

```bash
npm install qr-code-styling
```
Expected: `qr-code-styling` added to dependencies (^1.x).

- [ ] **Step 2: Write the failing test**

Create `src/components/admin/qr-sheet/__tests__/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickEcLevel } from "../render";

describe("pickEcLevel", () => {
  it("prefers H for short URLs", () => {
    expect(pickEcLevel("https://q.defcon.run/CTF", false)).toBe("H");
  });

  it("floors at Q when a logo is present", () => {
    // A URL long enough to force below Q must throw instead of degrading to M/L.
    const long = "https://q.defcon.run/" + "A".repeat(1600);
    const noLogo = pickEcLevel(long, false);
    expect(["M", "L"]).toContain(noLogo);
    expect(() => pickEcLevel(long, true)).toThrow(/too long/i);
  });

  it("throws when the URL exceeds even level L", () => {
    const monster = "https://q.defcon.run/" + "A".repeat(4000);
    expect(() => pickEcLevel(monster, false)).toThrow(/too long/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/render.test.ts
```
Expected: FAIL — cannot resolve `../render`.

- [ ] **Step 4: Implement `render.ts`**

```ts
/**
 * Styled QR rendering for the sheet designer. Browser-only at the PNG layer
 * (qr-code-styling draws on canvas; dynamically imported so this module can
 * still be IMPORTED server-side / in tests for pickEcLevel).
 *
 * Error-correction: dc33's adaptive ladder H→Q→M→L, probed with the plain
 * `qrcode` lib (sync, node-safe). A center logo floors the ladder at Q — the
 * logo obscures modules, so we refuse to degrade below 25% recovery.
 */
import QRCodeLib from "qrcode";

import { LOGO_SIZE_RATIO, type QrStyle } from "./styles";

const EC_LADDER = ["H", "Q", "M", "L"] as const;
type EcLevel = (typeof EC_LADDER)[number];

export function pickEcLevel(url: string, hasLogo: boolean): EcLevel {
  const ladder = hasLogo ? EC_LADDER.slice(0, 2) : EC_LADDER;
  for (const level of ladder) {
    try {
      QRCodeLib.create(url, { errorCorrectionLevel: level });
      return level;
    } catch {
      // too much data for this level — try the next one
    }
  }
  throw new Error(
    hasLogo
      ? "URL too long for a QR code with a logo — shorten the URL or remove the logo."
      : "URL too long for a QR code."
  );
}

// qr-code-styling's type names for our style vocabulary.
const MODULE_TYPE = {
  square: "square",
  dots: "dots",
  rounded: "rounded",
  classy: "classy",
} as const;
const EYE_FRAME_TYPE = {
  square: "square",
  rounded: "extra-rounded",
  dot: "dot",
} as const;
const EYE_BALL_TYPE = { square: "square", rounded: "dot", dot: "dot" } as const;

/** Render one styled QR as a PNG ArrayBuffer at sizePx × sizePx. Browser only. */
export async function renderQrPng(
  url: string,
  style: QrStyle,
  sizePx: number
): Promise<ArrayBuffer> {
  const { default: QRCodeStyling } = await import("qr-code-styling");
  const level = pickEcLevel(url, Boolean(style.logo));

  const qr = new QRCodeStyling({
    width: sizePx,
    height: sizePx,
    type: "canvas",
    data: url,
    margin: 0,
    qrOptions: { errorCorrectionLevel: level },
    dotsOptions: { type: MODULE_TYPE[style.moduleShape], color: style.moduleColor },
    cornersSquareOptions: {
      type: EYE_FRAME_TYPE[style.eyeShape],
      color: style.eyeColor,
    },
    cornersDotOptions: {
      type: EYE_BALL_TYPE[style.eyeShape],
      color: style.eyeColor,
    },
    backgroundOptions: { color: style.background },
    ...(style.logo
      ? {
          image: style.logo,
          imageOptions: {
            imageSize: LOGO_SIZE_RATIO,
            margin: Math.max(2, Math.round(sizePx / 100)),
            hideBackgroundDots: true,
            crossOrigin: "anonymous",
          },
        }
      : {}),
  });

  const blob = (await qr.getRawData("png")) as Blob | null;
  if (!blob) throw new Error("QR rendering produced no image data.");
  return blob.arrayBuffer();
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/render.test.ts
```
Expected: PASS. (If `QRCodeLib.create` import style errors under vitest, switch to `import * as QRCodeLib from "qrcode"` — match whatever `src/entities/run-user.ts` does with its `qrcode` import.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/admin/qr-sheet/
git commit -m "feat(qr): styled QR renderer (qr-code-styling) with adaptive EC ladder"
```

---

### Task 5: PDF composer (`pdf.ts`)

**Files:**
- Create: `src/components/admin/qr-sheet/pdf.ts`
- Test: `src/components/admin/qr-sheet/__tests__/pdf.test.ts` (pure helpers: `sheetFilename`, `buildProgressiveUrls`; plus a full `buildSheetPdf` smoke test with a stub renderer)

**Interfaces:**
- Consumes: `SheetLayout`, `cellOrigin`, `PAGE_WIDTH`, `PAGE_HEIGHT`, `DPI` from `./templates`; `pdf-lib` (`PDFDocument`, `rgb`).
- Produces:
  - `type RenderPng = (url: string, sizePx: number) => Promise<ArrayBuffer>`
  - `buildSheetPdf(opts: { url: string; layout: SheetLayout; includeProofPages: boolean; renderPng: RenderPng }): Promise<Uint8Array>`
  - `sheetFilename(url: string, layout: SheetLayout): string`
  - `buildProgressiveUrls(url: string, totalCells: number): string[]`

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/qr-sheet/__tests__/pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import QRCodeLib from "qrcode";

import { parseTemplate } from "../templates";
import { sheetFilename, buildProgressiveUrls, buildSheetPdf } from "../pdf";

describe("sheetFilename", () => {
  it("uses the q.defcon.run code as slug", () => {
    const l = parseTemplate("4x6")!;
    const name = sheetFilename("https://q.defcon.run/CTF", l);
    expect(name).toMatch(/^qr-sheet-ctf-4x6-\d+(\.\d+)?x\d+(\.\d+)?in\.pdf$/);
  });
  it("falls back to hostname for arbitrary URLs, exact Avery inches", () => {
    const l = parseTemplate("5160")!;
    expect(sheetFilename("https://example.com/x?y=1", l)).toBe(
      "qr-sheet-example.com-avery-5160-2.625x1in.pdf"
    );
  });
  it("survives unparseable URLs", () => {
    const l = parseTemplate("4x6")!;
    expect(sheetFilename("not a url", l)).toContain("qr-sheet-url-");
  });
});

describe("buildProgressiveUrls", () => {
  const url = "https://q.defcon.run/LONGCODE";
  it("starts at the origin, ends at the full URL, exact cell count", () => {
    const urls = buildProgressiveUrls(url, 12);
    expect(urls).toHaveLength(12);
    expect(urls[0]).toBe("https://q.defcon.run");
    expect(urls[urls.length - 1]).toBe(url);
    // monotonically non-shrinking prefixes of the target
    for (let i = 1; i < urls.length; i++) {
      expect(urls[i].length).toBeGreaterThanOrEqual(urls[i - 1].length);
      expect(url.startsWith(urls[i])).toBe(true);
    }
  });
  it("handles more cells than characters by padding with the full URL", () => {
    const urls = buildProgressiveUrls("https://a.io/x", 30);
    expect(urls).toHaveLength(30);
    expect(urls[29]).toBe("https://a.io/x");
  });
});

describe("buildSheetPdf (stub renderer)", () => {
  // Real (tiny) PNGs from the plain qrcode lib — pdf-lib must parse them.
  const stubRender = async (url: string, sizePx: number) => {
    const buf = await QRCodeLib.toBuffer(url, { width: Math.max(32, sizePx), margin: 0 });
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };

  it("produces a 1-page PDF without proof pages", async () => {
    const bytes = await buildSheetPdf({
      url: "https://q.defcon.run/CTF",
      layout: parseTemplate("3x3")!,
      includeProofPages: false,
      renderPng: stubRender,
    });
    expect(bytes.length).toBeGreaterThan(1000);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("produces 4+ pages with proof pages on", async () => {
    const bytes = await buildSheetPdf({
      url: "https://q.defcon.run/CTF",
      layout: parseTemplate("3x3")!,
      includeProofPages: true,
      renderPng: stubRender,
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    // page 1 grid + page 2 giant + ≥1 size-comparison page + progressive page
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/pdf.test.ts
```
Expected: FAIL — cannot resolve `../pdf`.

- [ ] **Step 3: Implement `pdf.ts`**

Port dc33's composition; the one deliberate change from dc33: QR PNGs are rendered at high resolution (4 px per pt, ~288 DPI, capped 1200 px) and drawn at the point size, instead of dc33's 1 px = 1 pt.

```ts
/**
 * PDF sheet composition — dc33's /api/qr/sheet layout ported to run client
 * side. The QR renderer is INJECTED (RenderPng) so this module has no canvas
 * dependency and stays node-testable; the designer passes the styled
 * qr-code-styling renderer, tests pass a plain-qrcode stub.
 *
 * Deviation from dc33: QRs render at ~288 DPI (4 px/pt, capped 1200 px) and
 * are drawn scaled to their point size — dc33 rendered at 72 DPI which prints
 * soft. Layout coordinates are unchanged.
 */
import { PDFDocument, rgb, type PDFPage, type PDFImage } from "pdf-lib";

import {
  DPI,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  cellOrigin,
  type SheetLayout,
} from "./templates";

export type RenderPng = (url: string, sizePx: number) => Promise<ArrayBuffer>;

const GREY = rgb(0.3, 0.3, 0.3);
const LIGHT_GREY = rgb(0.7, 0.7, 0.7);
const FAINT_GREY = rgb(0.6, 0.6, 0.6);
const MID_GREY = rgb(0.4, 0.4, 0.4);
const HEADER_Y = PAGE_HEIGHT - 30;

/** Print-resolution pixel size for a QR drawn at sizePt points. */
function pxFor(sizePt: number): number {
  return Math.min(1200, Math.max(64, Math.round(sizePt * 4)));
}

function drawHeader(page: PDFPage, text: string) {
  page.drawText(text, { x: 40, y: HEADER_Y, size: 10, color: GREY });
}

/** dc33's manual dotted fold lines between grid cells (grids only). */
function drawFoldLines(page: PDFPage, l: SheetLayout) {
  const dash = 3;
  const gap = 3;
  for (let i = 1; i < l.across; i++) {
    const x = l.startX + i * l.qrBox;
    const top = l.startY + l.qrBox;
    const bottom = l.startY - (l.down - 1) * l.qrBox;
    let y = top;
    while (y > bottom) {
      const end = Math.max(y - dash, bottom);
      page.drawLine({
        start: { x, y },
        end: { x, y: end },
        thickness: 0.5,
        color: LIGHT_GREY,
      });
      y = end - gap;
    }
  }
  for (let i = 1; i < l.down; i++) {
    const y = l.startY + l.qrBox - i * l.qrBox;
    const right = l.startX + l.across * l.qrBox;
    let x = l.startX;
    while (x < right) {
      const end = Math.min(x + dash, right);
      page.drawLine({
        start: { x, y },
        end: { x: end, y },
        thickness: 0.5,
        color: LIGHT_GREY,
      });
      x = end + gap;
    }
  }
}

/** Draw one QR image centered in cell (dx, dy) at qrPt points square. */
function drawQrInCell(
  page: PDFPage,
  l: SheetLayout,
  image: PDFImage,
  qrPt: number,
  dx: number,
  dy: number
): { x: number; y: number } {
  const o = cellOrigin(l, dx, dy);
  const x = o.x + (l.cellW - qrPt) / 2;
  const y = o.y + (l.cellH - qrPt) / 2;
  page.drawImage(image, { x, y, width: qrPt, height: qrPt });
  return { x, y };
}

/** dc33 page-3/4 size-comparison grid configs, verbatim. */
const COMPARISON_CONFIGS = [
  { across: 2, down: 2 }, { across: 2, down: 3 }, { across: 2, down: 4 },
  { across: 3, down: 3 }, { across: 3, down: 4 }, { across: 3, down: 5 },
  { across: 4, down: 5 }, { across: 4, down: 6 }, { across: 4, down: 7 },
  { across: 5, down: 6 }, { across: 5, down: 8 }, { across: 6, down: 8 },
  { across: 7, down: 8 }, { across: 8, down: 8 },
];

/** dc33's progressive data-density URL ladder: origin → full URL. */
export function buildProgressiveUrls(url: string, totalCells: number): string[] {
  const parts = url.split("/");
  const origin = parts.slice(0, 3).join("/");
  const fullPath = parts.length > 3 ? "/" + parts.slice(3).join("/") : "";
  const urls: string[] = [origin];
  const cellsNeeded = Math.min(Math.max(totalCells - 1, 0), fullPath.length);
  const charsPerStep = Math.max(1, Math.ceil(fullPath.length / Math.max(cellsNeeded, 1)));
  for (let i = 0; i < cellsNeeded; i++) {
    const end = Math.min((i + 1) * charsPerStep, fullPath.length);
    urls.push(origin + fullPath.substring(0, end));
    if (end >= fullPath.length) break;
  }
  while (urls.length < totalCells) urls.push(url);
  urls.splice(totalCells === 0 ? 0 : totalCells);
  return urls;
}

/** `qr-sheet-<slug>-<layout>-<WxH>in.pdf` — slug from q code or hostname. */
export function sheetFilename(url: string, layout: SheetLayout): string {
  let slug = "url";
  const codeMatch = url.match(/^https:\/\/q\.defcon\.run\/([A-Za-z0-9_-]+)/i);
  if (codeMatch) {
    slug = codeMatch[1].toLowerCase();
  } else {
    try {
      slug = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "") || "url";
    } catch {
      /* keep "url" */
    }
  }
  const dims =
    layout.kind === "avery"
      ? `${layout.widthIn}x${layout.heightIn}in`
      : `${layout.widthIn.toFixed(1)}x${layout.heightIn.toFixed(1)}in`;
  return `qr-sheet-${slug}-${layout.name}-${dims}.pdf`;
}

export async function buildSheetPdf(opts: {
  url: string;
  layout: SheetLayout;
  includeProofPages: boolean;
  renderPng: RenderPng;
}): Promise<Uint8Array> {
  const { url, layout: l, includeProofPages, renderPng } = opts;
  const doc = await PDFDocument.create();

  // ── Page 1: the sheet grid ─────────────────────────────────────────────
  const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (l.kind === "grid") drawFoldLines(page1, l);

  const qrPt = Math.floor(l.qrBox * 0.9);
  const cellPng = await renderPng(url, pxFor(qrPt));
  const cellImage = await doc.embedPng(cellPng);
  for (let dx = 0; dx < l.across; dx++) {
    for (let dy = 0; dy < l.down; dy++) {
      drawQrInCell(page1, l, cellImage, qrPt, dx, dy);
    }
  }
  drawHeader(page1, url);

  if (includeProofPages) {
    // ── Page 2: one giant QR ─────────────────────────────────────────────
    const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const giantPt = Math.min(PAGE_WIDTH, PAGE_HEIGHT) * 0.7;
    const giantImage = await doc.embedPng(await renderPng(url, pxFor(giantPt)));
    page2.drawImage(giantImage, {
      x: (PAGE_WIDTH - giantPt) / 2,
      y: (PAGE_HEIGHT - giantPt) / 2,
      width: giantPt,
      height: giantPt,
    });
    drawHeader(page2, url);

    // ── Pages 3(–4): size comparison, one QR per template config ─────────
    const margin = 40;
    const spacing = 15;
    const labelH = 12;
    let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, url);
    let cx = margin;
    let cy = PAGE_HEIGHT - margin;
    let rowMax = 0;
    let overflowed = false;

    for (const cfg of COMPARISON_CONFIGS) {
      const boxPt = Math.min(
        (PAGE_WIDTH - 40) / cfg.across,
        (PAGE_HEIGHT - 80) / cfg.down
      );
      const sizePt = Math.floor(boxPt * 0.9);
      const image = await doc.embedPng(await renderPng(url, pxFor(sizePt)));

      if (cx + sizePt > PAGE_WIDTH - margin) {
        cx = margin;
        cy = cy - rowMax - labelH - spacing;
        rowMax = 0;
      }
      if (cy - sizePt - labelH < margin) {
        if (overflowed) break; // no room even on page 4 — dc33 also stopped
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        drawHeader(page, url);
        cx = margin;
        cy = PAGE_HEIGHT - margin;
        rowMax = 0;
        overflowed = true;
      }
      page.drawImage(image, { x: cx, y: cy - sizePt, width: sizePt, height: sizePt });
      const label = `${cfg.across}x${cfg.down}`;
      page.drawText(label, {
        x: cx + sizePt / 2 - (label.length * 7 * 0.4) / 2,
        y: cy - sizePt - 10,
        size: 7,
        color: GREY,
      });
      cx += sizePt + spacing;
      rowMax = Math.max(rowMax, sizePt);
    }

    // ── Progressive data-density page ────────────────────────────────────
    const prog = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    prog.drawText("Progressive QR Data Density Test", {
      x: 40,
      y: HEADER_Y,
      size: 12,
      color: GREY,
    });
    prog.drawText(`Base URL: ${url}`, {
      x: 40,
      y: HEADER_Y - 15,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    });

    const urls = buildProgressiveUrls(url, l.across * l.down);
    const origin = url.split("/").slice(0, 3).join("/");
    let i = 0;
    for (let dx = 0; dx < l.across; dx++) {
      for (let dy = 0; dy < l.down; dy++) {
        if (i >= urls.length) break;
        const u = urls[i];
        try {
          const image = await doc.embedPng(await renderPng(u, pxFor(qrPt)));
          const pos = drawQrInCell(prog, l, image, qrPt, dx, dy);
          const extra = u.length - origin.length;
          const label = extra === 0 ? "Base" : `+${extra}`;
          prog.drawText(label, {
            x: pos.x + qrPt / 2 - label.length * 6 * 0.3,
            y: pos.y - 10,
            size: 6,
            color: FAINT_GREY,
          });
        } catch {
          // an individual progressive step failing must not kill the sheet
        }
        i++;
      }
    }
    const ey = 60;
    prog.drawText("This page tests QR code readability as data density increases.", {
      x: 40, y: ey + 30, size: 9, color: MID_GREY,
    });
    prog.drawText("Each QR code adds more characters from the full URL path.", {
      x: 40, y: ey + 15, size: 9, color: MID_GREY,
    });
    prog.drawText(
      `Template: ${l.across}×${l.down}, Cell size: ${(l.qrBox / DPI).toFixed(2)}"`,
      { x: 40, y: ey, size: 9, color: MID_GREY }
    );
  }

  return doc.save();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/__tests__/pdf.test.ts
```
Expected: PASS (proof-page test may take a few seconds — it renders ~25 PNGs).

- [ ] **Step 5: Run the whole qr-sheet suite together**

```bash
nvm use 23.6.0 && npx vitest run src/components/admin/qr-sheet/
```
Expected: PASS (templates, styles, render, pdf).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/qr-sheet/
git commit -m "feat(qr): client-side PDF sheet composer with dc33 proof pages"
```

---

### Task 6: Designer UI + `/admin/qr/sheet` route

**Files:**
- Create: `src/components/admin/QrSheetDesigner.tsx`
- Create: `src/app/(protected)/admin/qr/sheet/page.tsx`

**Interfaces:**
- Consumes: `gateAdminPage` from `../gate`; `cls`, `QR_ORIGIN` from `@/components/admin/qr-ui`; everything from `qr-sheet/templates`, `qr-sheet/styles`, `qr-sheet/render`, `qr-sheet/pdf`.
- Produces: `QrSheetDesigner` client component with prop `{ initialUrl: string }` (default export). Route `/admin/qr/sheet?url=…`.

- [ ] **Step 1: Implement the route page**

Create `src/app/(protected)/admin/qr/sheet/page.tsx`:

```tsx
import Link from "next/link";

import QrSheetDesigner from "@/components/admin/QrSheetDesigner";
import { cls } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../gate";

/**
 * /admin/qr/sheet — printable QR sheet designer (dc33 QRSheet port). Gated
 * like every /admin/qr surface (admin | runadmin | qradmin → else 404).
 * ?url=… prefills the designer; only absolute http(s) URLs are accepted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QrSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  await gateAdminPage();
  const { url } = await searchParams;
  const raw = typeof url === "string" ? url : "";
  const initialUrl = /^https?:\/\/\S+$/.test(raw) ? raw : "";

  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <Link href="/admin/qr" className={`${cls.btn} self-start`}>
          ← QR / CTF
        </Link>
        <h1 className={cls.h1}>
          QR sheet designer<span className="teal-dot">.</span>
        </h1>
        <p className={cls.sub}>
          Style a QR code and download a printable US-Letter PDF — grids with
          fold lines, or Avery label stock. Everything renders in your browser.
        </p>
      </div>
      <QrSheetDesigner initialUrl={initialUrl} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `QrSheetDesigner.tsx`**

Create `src/components/admin/QrSheetDesigner.tsx`. Structure (complete file):

```tsx
"use client";

/**
 * QR sheet designer (dc33 QRSheet port, restyled + QR styling). Fully
 * client-side: styled QRs via qr-code-styling, PDF via pdf-lib, download via
 * object URL. No API calls, no persistence — the URL param is the only input.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cls, QR_ORIGIN } from "@/components/admin/qr-ui";
import {
  AVERY_INFO,
  GRID_PRESETS,
  parseTemplate,
  type SheetLayout,
} from "@/components/admin/qr-sheet/templates";
import {
  BUNDLED_LOGOS,
  DC34_PRESETS,
  contrastWarning,
  type ModuleShape,
  type EyeShape,
  type QrStyle,
} from "@/components/admin/qr-sheet/styles";
import { renderQrPng } from "@/components/admin/qr-sheet/render";
import { buildSheetPdf, sheetFilename } from "@/components/admin/qr-sheet/pdf";

const MODULE_SHAPES: ModuleShape[] = ["square", "dots", "rounded", "classy"];
const EYE_SHAPES: EyeShape[] = ["square", "rounded", "dot"];

export default function QrSheetDesigner({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl || `${QR_ORIGIN}/`);
  const [template, setTemplate] = useState("7x9");
  const [style, setStyle] = useState<QrStyle>(DC34_PRESETS[0].style);
  const [presetId, setPresetId] = useState<string>(DC34_PRESETS[0].id);
  const [proofPages, setProofPages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const layout: SheetLayout | null = useMemo(
    () => parseTemplate(template),
    [template]
  );
  const urlOk = /^https?:\/\/\S+$/.test(url.trim());
  const contrast = contrastWarning(style);

  const patchStyle = (patch: Partial<QrStyle>) => {
    setPresetId("");
    setStyle((s) => {
      const next = { ...s, ...patch };
      if (patch.logo === undefined && "logo" in patch) delete next.logo;
      return next;
    });
  };

  const applyPreset = (id: string) => {
    const p = DC34_PRESETS.find((p) => p.id === id);
    if (!p) return;
    setPresetId(id);
    setStyle({ ...p.style });
  };

  const onLogoUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patchStyle({ logo: String(reader.result) });
    reader.onerror = () => setWarning("Could not read that image file.");
    reader.readAsDataURL(file);
  };

  // ── Live preview (debounced) ──────────────────────────────────────────────
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlOk) return;
    const t = setTimeout(async () => {
      try {
        setWarning(contrast);
        const png = await renderQrPng(url.trim(), style, 240);
        const objUrl = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = objUrl;
        setPreviewSrc(objUrl);
        setError(null);
      } catch (e) {
        // Retry once without the logo — a broken image must not brick preview.
        if (style.logo) {
          try {
            const png = await renderQrPng(url.trim(), { ...style, logo: undefined }, 240);
            const objUrl = URL.createObjectURL(new Blob([png], { type: "image/png" }));
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = objUrl;
            setPreviewSrc(objUrl);
            setWarning("Logo image failed to load — previewing without it.");
            setError(null);
            return;
          } catch {
            /* fall through to the underlying error */
          }
        }
        setError(e instanceof Error ? e.message : "Failed to render QR.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [url, urlOk, style, contrast]);

  // ── Download ──────────────────────────────────────────────────────────────
  const download = useCallback(async () => {
    if (!urlOk || !layout) return;
    setBusy(true);
    setError(null);
    try {
      const effective = { ...style };
      let logoWarned = false;
      const renderPng = async (u: string, px: number) => {
        try {
          return await renderQrPng(u, effective, px);
        } catch (e) {
          if (effective.logo) {
            // drop the logo for the whole sheet and warn once
            delete effective.logo;
            if (!logoWarned) {
              setWarning("Logo image failed to load — sheet generated without it.");
              logoWarned = true;
            }
            return renderQrPng(u, effective, px);
          }
          throw e;
        }
      };
      const bytes = await buildSheetPdf({
        url: url.trim(),
        layout,
        includeProofPages: proofPages,
        renderPng,
      });
      const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = sheetFilename(url.trim(), layout);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the PDF.");
    } finally {
      setBusy(false);
    }
  }, [url, urlOk, layout, style, proofPages]);

  const activeLogo = BUNDLED_LOGOS.find((l) => l.path === style.logo)?.id
    ?? (style.logo?.startsWith("data:") ? "upload" : style.logo ? "custom" : "none");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
      {/* ── Controls ── */}
      <div className={`${cls.cardPad} flex flex-col gap-5`}>
        {/* URL */}
        <div>
          <label className={cls.label}>URL</label>
          <input
            className={cls.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`${QR_ORIGIN}/CODE`}
            spellCheck={false}
          />
          {!urlOk && (
            <p className="text-[11.5px] text-danger mt-1">
              Enter an absolute http(s) URL.
            </p>
          )}
        </div>

        {/* Layout */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>Layout</label>
          <div className="flex flex-wrap gap-2">
            {GRID_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setTemplate(p.value)}
                className={template === p.value ? cls.btnPrimary : cls.btn}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              className={`${cls.input} max-w-[140px]`}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="AxB or Avery #"
              spellCheck={false}
            />
            <select
              className={`${cls.select} max-w-[280px]`}
              value={layout?.kind === "avery" ? layout.name.replace("avery-", "") : ""}
              onChange={(e) => e.target.value && setTemplate(e.target.value)}
            >
              <option value="">Avery templates…</option>
              {AVERY_INFO.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.desc} ({a.dims})
                </option>
              ))}
            </select>
          </div>
          {!layout && (
            <p className="text-[11.5px] text-danger">
              Grid must be 1–12 per axis (e.g. 5x7) or a known Avery number.
            </p>
          )}
        </div>

        {/* Presets */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>DC34 templates</label>
          <div className="flex flex-wrap gap-2">
            {DC34_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={presetId === p.id ? cls.btnPrimary : cls.btn}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Style controls */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={cls.label}>Modules</label>
            <select
              className={cls.select}
              value={style.moduleShape}
              onChange={(e) => patchStyle({ moduleShape: e.target.value as ModuleShape })}
            >
              {MODULE_SHAPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={cls.label}>Module color</label>
            <input
              type="color"
              className="w-full h-9 rounded-lg border border-divider bg-content1"
              value={style.moduleColor}
              onChange={(e) => patchStyle({ moduleColor: e.target.value })}
            />
          </div>
          <div>
            <label className={cls.label}>Eyes</label>
            <select
              className={cls.select}
              value={style.eyeShape}
              onChange={(e) => patchStyle({ eyeShape: e.target.value as EyeShape })}
            >
              {EYE_SHAPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={cls.label}>Eye color</label>
            <input
              type="color"
              className="w-full h-9 rounded-lg border border-divider bg-content1"
              value={style.eyeColor}
              onChange={(e) => patchStyle({ eyeColor: e.target.value })}
            />
          </div>
        </div>

        {/* Logo */}
        <div className="flex flex-col gap-2">
          <label className={cls.label}>Center logo (forces high error correction)</label>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => patchStyle({ logo: undefined })}
              className={activeLogo === "none" ? cls.btnPrimary : cls.btn}
            >
              None
            </button>
            {BUNDLED_LOGOS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => patchStyle({ logo: l.path })}
                className={activeLogo === l.id ? cls.btnPrimary : cls.btn}
              >
                {l.label}
              </button>
            ))}
            <label className={`${cls.btn} cursor-pointer`}>
              Upload…
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onLogoUpload(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <p className="text-[11.5px] text-default-400">
            Uploads stay in your browser — the image is embedded straight into
            the PDF, never sent to a server.
          </p>
        </div>

        {/* Proof pages + download */}
        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-divider">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={proofPages}
              onChange={(e) => setProofPages(e.target.checked)}
            />
            Include proof pages (giant QR, size comparison, density test)
          </label>
          <button
            type="button"
            onClick={download}
            disabled={!urlOk || !layout || busy}
            className={cls.btnPrimary}
          >
            {busy ? "Generating…" : "Download PDF"}
          </button>
        </div>

        {warning && <p className="text-[12.5px] text-warning">{warning}</p>}
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>

      {/* ── Preview ── */}
      <div className={`${cls.cardPad} flex flex-col gap-4 items-center`}>
        <span className={cls.label}>Preview</span>
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt="QR preview"
            className="w-[240px] h-[240px] rounded-lg border border-divider bg-white"
          />
        ) : (
          <div className="w-[240px] h-[240px] rounded-lg border border-divider bg-content2" />
        )}
        {layout && (
          <>
            <div
              className="relative border border-divider bg-white rounded-sm"
              style={{ width: 153, height: 198 }}
              aria-label="Page layout thumbnail"
            >
              {Array.from({ length: layout.across * layout.down }).map((_, i) => {
                const dx = i % layout.across;
                const dy = Math.floor(i / layout.across);
                const s = 0.25; // 612×792pt → 153×198px
                return (
                  <div
                    key={i}
                    className="absolute bg-black/70 rounded-[1px]"
                    style={{
                      left: (layout.startX + dx * layout.pitchX + (layout.cellW - layout.qrBox * 0.9) / 2) * s,
                      bottom: (layout.startY - dy * layout.pitchY + (layout.cellH - layout.qrBox * 0.9) / 2) * s,
                      width: layout.qrBox * 0.9 * s,
                      height: layout.qrBox * 0.9 * s,
                    }}
                  />
                );
              })}
            </div>
            <p className="text-[11.5px] text-default-400 text-center">
              {layout.across}×{layout.down} · {layout.widthIn.toFixed(2)}″ ×{" "}
              {layout.heightIn.toFixed(2)}″ cells
              {layout.kind === "grid" ? " · fold lines" : " · Avery stock"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: no new errors (pre-existing warnings acceptable if untouched files).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/QrSheetDesigner.tsx "src/app/(protected)/admin/qr/sheet/"
git commit -m "feat(qr): /admin/qr/sheet designer — styled QRs, live preview, PDF download"
```

---

### Task 7: Entry points from the QR admin pages

**Files:**
- Modify: `src/app/(protected)/admin/qr/page.tsx` (list rows + header)
- Modify: `src/app/(protected)/admin/qr/[code]/page.tsx` (header buttons)

**Interfaces:**
- Consumes: `QR_ORIGIN` (already imported in the list page; add to `[code]` page imports from `@/components/admin/qr-ui`).
- Produces: links to `/admin/qr/sheet?url=…`.

- [ ] **Step 1: List page — per-row "sheet" action + header link**

In `src/app/(protected)/admin/qr/page.tsx`:

1. Header actions — next to the `← Admin` link, add a sheet designer link (wrap both in the existing flex container):
```tsx
        <div className="flex items-center gap-2">
          <Link href="/admin/qr/sheet" className={cls.btn}>
            ⊞ Sheet designer
          </Link>
          <Link href="/admin" className={cls.btn}>
            ← Admin
          </Link>
        </div>
```
2. The table's last header cell list currently ends with `""` — change the array to end with `"", ""` (two action columns) and update both `colSpan={7}` occurrences for the codes table to `colSpan={8}`.
3. In each code row, add a new `<td>` before the existing "edit" cell:
```tsx
                      <td className={cls.td}>
                        <Link
                          href={`/admin/qr/sheet?url=${encodeURIComponent(`${QR_ORIGIN}/${row.code}`)}`}
                          className="text-default-400"
                        >
                          sheet
                        </Link>
                      </td>
```

- [ ] **Step 2: Edit page — "Print sheet" button**

In `src/app/(protected)/admin/qr/[code]/page.tsx`, import `QR_ORIGIN` alongside `cls`, and change the header block to put the back link and a print button on one row:

```tsx
        <div className="flex items-center justify-between gap-2">
          <Link href="/admin/qr" className={cls.btn}>
            ← QR / CTF
          </Link>
          <Link
            href={`/admin/qr/sheet?url=${encodeURIComponent(`${QR_ORIGIN}/${record.code}`)}`}
            className={cls.btnPrimary}
          >
            ⊞ Print sheet
          </Link>
        </div>
```
(Replaces the `self-start` link inside the existing `flex flex-col gap-2` wrapper; the `h1` stays below.)

- [ ] **Step 3: Type-check, lint, full test suite**

```bash
npx tsc --noEmit && npm run lint && nvm use 23.6.0 && npx vitest run
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(protected)/admin/qr/page.tsx" "src/app/(protected)/admin/qr/[code]/page.tsx"
git commit -m "feat(qr): sheet-designer entry links on QR list and edit pages"
```

---

### Task 8: Quality gates, visual verification, PR

**Files:** none new (verification + PR).

- [ ] **Step 1: Production build**

```bash
npm run build
```
Expected: build succeeds; `/admin/qr/sheet` appears in the route manifest.

- [ ] **Step 2: Full unit suite one more time**

```bash
nvm use 23.6.0 && npx vitest run
```
Expected: all green.

- [ ] **Step 3: Visual verification (local dev)**

```bash
PORT=3001 npm run dev
```
With a signed-in admin session (dev auth), visit `http://localhost:3001/admin/qr/sheet?url=https%3A%2F%2Fq.defcon.run%2FCTF` and verify:
- Live preview renders; presets visibly change modules/eyes/logo.
- Custom grid `5x7`, Avery `5160`, and default `7x9` all produce sane thumbnails.
- Download produces a PDF: page 1 grid + fold lines (grid) / exact labels (Avery), proof pages present when checked, absent when not.
- Phone-scan the preview for each DC34 preset — all four must scan.
- `sheet` links on the list page and `Print sheet` on an edit page prefill the URL.

If no local session/DDB is available, note it and rely on post-deploy verify (login page is client-mounted-gated; curl checks are blind — use a browser).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/qr-sheet-designer
gh pr create --title "feat(qr): /admin/qr/sheet QR sheet designer (dc33 port + styling) + qradmin group" --body "$(cat <<'EOF'
## Summary
- Ports the dc33 QRSheet printable-PDF concept into run.human's /admin/qr as a client-side **sheet designer**: pick any URL (prefilled from a code), style the QR, choose a grid or Avery layout, download a US-Letter PDF.
- **QR styling** via qr-code-styling: module shapes (square/dots/rounded/classy), eye shapes/colors, center logo (bundled DC34 marks or private upload), and four DC34 presets (Classic, Run Hacker Run, Mesh, Stealth) with a scannability contrast warning.
- **dc33 parity**: 7×9/3×3/4×6/6×8 + custom grids with dotted fold lines, all 8 Avery templates with exact label geometry, optional proof pages (giant QR, size comparison, progressive data-density test), adaptive error correction (H→Q→M→L; floored at Q with a logo).
- **New `qradmin` group** unlocks the whole /admin/qr area (pages + API) without granting /admin root; admin/runadmin unchanged; all denials remain 404.
- No new server surface: PDF + QR rendering are fully client-side; only new dependency is qr-code-styling.

Spec: docs/superpowers/specs/2026-07-12-qr-sheet-designer-design.md
Plan: docs/superpowers/plans/2026-07-12-qr-sheet-designer.md

## Test plan
- [ ] vitest: gate groups, layout math vs dc33 coordinates, presets/contrast, EC ladder, filename/progressive-URL helpers, PDF page counts (stub renderer)
- [ ] npm run build
- [ ] Local visual: preview, presets, PDF download (grid + Avery), proof pages toggle
- [ ] Phone-scan all four DC34 presets

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL printed. Do NOT merge — user approves merges.

---

## Self-Review Notes

- **Spec coverage:** gating (Task 1), layouts/Avery (Task 2), styling + presets + logos + contrast (Task 3), styled rendering + EC ladder (Task 4), PDF + proof pages + fold lines + filename (Task 5), designer UI + route + upload + warnings (Task 6), entry points (Task 7), quality gates + PR (Task 8). Dropped-scope items (quota, quick links, auto-download) have no tasks — intentional.
- **Spec deviation folded in:** no skull asset exists; bunny-head.png is opaque-black. Bundled logos are dcjack/meshtastic/dc34; Task 3 Step 6 updates the spec to match.
- **Type consistency check:** `SheetLayout` fields used by pdf.ts/designer (`qrBox`, `cellW`, `cellH`, `pitchX`, `pitchY`, `startX`, `startY`, `widthIn`, `heightIn`, `kind`, `name`, `across`, `down`) all defined in Task 2. `QrStyle`/`ModuleShape`/`EyeShape` (Task 3) consumed by render.ts (Task 4) and designer (Task 6). `RenderPng` signature `(url, sizePx) => Promise<ArrayBuffer>` matches designer's wrapper and tests' stub. `requireGroups`/`revalidateGroups`/`QR_ADMIN_GROUPS` names consistent across Task 1 files.
