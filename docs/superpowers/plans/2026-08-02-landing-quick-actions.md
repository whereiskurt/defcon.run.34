# Landing-Page Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Check-in`, `Add Run` and `Scan` CTAs to the signed-in landing-page hero of `run.human`, reusing the flows already wired on `/whoami`.

**Architecture:** Two pure modules (`lib/gpx-addrun.ts`, `lib/scanner-copy.ts`) are extracted so the landing page and `/whoami` cannot drift. The landing hero is relaid out from an absolutely-positioned overlay to normal flow so the card grows with five buttons. `WelcomeContent` mounts the two existing modals and does one non-blocking `GET /api/user` for cosmetic modal props.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, HeroUI, Tailwind 4, lucide-react, Vitest (node environment).

Spec: `docs/superpowers/specs/2026-08-02-landing-quick-actions-design.md`

## Global Constraints

- Working directory for every path below: `apps/run.human/webapp/`.
- Node: run `nvm use 22.12.0` before Vitest. There is **no `test` npm script** — run `npx vitest run`.
- `run.human` has **no jsdom and no `@testing-library/react`**. Do not write component-render tests. All assertions live in `src/lib/` modules or source-text guards.
- **Never reference `process.env.NEXT_PUBLIC_*` through a variable or parameter.** Next.js inlines only literal `process.env.NEXT_PUBLIC_FOO` member expressions at build time; an indirected read is `undefined` in the browser. Tests flip these with `vi.stubEnv`.
- The quick check-in POST body keys must remain exactly `["samples", "source"]`. Never send `isPrivate` from the client.
- `Scan` uses the new CMS key `socialqr.scan.button.short` (default `Scan`). It must **not** reuse `socialqr.scan.button`, which drives `/whoami`'s "Connect".
- `Check-in` uses the existing key `checkin.quick.button` (default `Check-in`). `Add Run` is hardcoded.
- ESLint is **not** a CI gate and `main` already ships React Compiler errors in these files. Capture an `origin/main` baseline before attributing any lint error to this work.

---

### Task 1: `gpxAddRunUrl()`

**Files:**
- Create: `src/lib/gpx-addrun.ts`
- Test: `src/lib/__tests__/gpx-addrun.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `gpxAddRunUrl(): string` — the terminal gpx QuickStart URL.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/gpx-addrun.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { gpxAddRunUrl } from "../gpx-addrun";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gpxAddRunUrl", () => {
  it("points at the local gpx dev server outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(gpxAddRunUrl()).toBe("http://localhost:3003/studio/app?addrun");
  });

  it("builds the region-prefixed studio URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "defcon.run");
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "use1");
    expect(gpxAddRunUrl()).toBe(
      "https://gpx.defcon.run/use1/studio/app?addrun",
    );
  });

  it("falls back to defcon.run and use1 when the env is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_DOMAIN", "");
    vi.stubEnv("NEXT_PUBLIC_REGION_SHORT", "");
    expect(gpxAddRunUrl()).toBe(
      "https://gpx.defcon.run/use1/studio/app?addrun",
    );
  });

  // The landmine this function exists to prevent: a link to the bare gpx
  // origin hits an interstitial that does location.replace('/'+region+'/'),
  // which drops the query string. The ?addrun payload would vanish with no
  // error. Only /{region}/studio/app is terminal.
  it("never returns the bare gpx origin and always keeps ?addrun", () => {
    vi.stubEnv("NODE_ENV", "production");
    const url = gpxAddRunUrl();
    expect(url).toMatch(/\/studio\/app\?addrun$/);
    expect(url).not.toBe("https://gpx.defcon.run");
    expect(url).not.toBe("https://gpx.defcon.run/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/gpx-addrun.test.ts
```

Expected: FAIL — `Failed to resolve import "../gpx-addrun"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/gpx-addrun.ts`:

```ts
/**
 * URL of the gpx.studio QuickStart hub ("Add Run").
 *
 * `/{region}/studio/app` is the ONLY terminal path on the gpx origin. Linking
 * to bare `gpx.defcon.run` hits an interstitial that runs
 * `location.replace('/' + region + '/')`, dropping both the query string and
 * the hash — `?addrun` disappears and nothing reports an error. `/use1` then
 * 307s query-stripped. Always link the full studio path.
 *
 * The `process.env.NEXT_PUBLIC_*` reads are deliberately written as literal
 * member expressions: Next.js inlines only that exact form at build time, so
 * reading them through a variable or parameter yields `undefined` in the
 * browser.
 */
export function gpxAddRunUrl(): string {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) return "http://localhost:3003/studio/app?addrun";

  const siteDomain = process.env.NEXT_PUBLIC_SITE_DOMAIN || "defcon.run";
  const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
  return `https://gpx.${siteDomain}/${region}/studio/app?addrun`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/gpx-addrun.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/gpx-addrun.ts apps/run.human/webapp/src/lib/__tests__/gpx-addrun.test.ts
git commit -m "feat(human): extract gpxAddRunUrl() with the bare-origin guard"
```

---

### Task 2: `buildScannerCopy()`

**Files:**
- Create: `src/lib/scanner-copy.ts`
- Test: `src/lib/__tests__/scanner-copy.test.ts`

**Interfaces:**
- Consumes: `ScannerCopy` (type) from `@/components/qr/QrScannerModal`.
- Produces: `type CopyResolver = (key: string, fallback: string) => string` and `buildScannerCopy(copyOr: CopyResolver): ScannerCopy`.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/scanner-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildScannerCopy } from "../scanner-copy";

describe("buildScannerCopy", () => {
  it("uses the fallback for every field when the CMS has nothing", () => {
    const copy = buildScannerCopy((_key, fallback) => fallback);
    expect(copy).toEqual({
      title: "Scan a runner",
      hint: "Point your camera at another runner's QR",
      miss: "Not a runner QR - keep it in frame",
      found: "🐰 Runner found!",
      claim: "Claim connection",
      again: "Scan another",
      unavailable:
        "Camera unavailable - use your phone's camera app on the QR instead.",
      cancel: "Done",
    });
  });

  it("lets a CMS value win over the fallback", () => {
    const copy = buildScannerCopy((key, fallback) =>
      key === "socialqr.scan.title" ? "Find a runner" : fallback,
    );
    expect(copy.title).toBe("Find a runner");
    expect(copy.cancel).toBe("Done");
  });

  it("asks for every socialqr.scan.* key exactly once", () => {
    const asked: string[] = [];
    buildScannerCopy((key, fallback) => {
      asked.push(key);
      return fallback;
    });
    expect(asked).toEqual([
      "socialqr.scan.title",
      "socialqr.scan.hint",
      "socialqr.scan.miss",
      "socialqr.scan.found",
      "socialqr.scan.claim",
      "socialqr.scan.again",
      "socialqr.scan.unavailable",
      "socialqr.scan.cancel",
    ]);
  });

  // The button LABEL key is deliberately absent: /whoami says "Connect" via
  // socialqr.scan.button and the landing page says "Scan" via
  // socialqr.scan.button.short. Pulling either into the shared modal copy
  // would let one CMS edit rename both buttons.
  it("does not own either button label", () => {
    const asked: string[] = [];
    buildScannerCopy((key, fallback) => {
      asked.push(key);
      return fallback;
    });
    expect(asked).not.toContain("socialqr.scan.button");
    expect(asked).not.toContain("socialqr.scan.button.short");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/scanner-copy.test.ts
```

Expected: FAIL — `Failed to resolve import "../scanner-copy"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/scanner-copy.ts`:

```ts
import type { ScannerCopy } from "@/components/qr/QrScannerModal";

/** Resolver that returns the CMS value for `key`, or `fallback` if unset. */
export type CopyResolver = (key: string, fallback: string) => string;

/**
 * Copy for `QrScannerModal`, shared by /whoami and the landing page so the two
 * entry points cannot drift.
 *
 * The trigger BUTTON label is intentionally not built here — see the test.
 */
export function buildScannerCopy(copyOr: CopyResolver): ScannerCopy {
  return {
    title: copyOr("socialqr.scan.title", "Scan a runner"),
    hint: copyOr(
      "socialqr.scan.hint",
      "Point your camera at another runner's QR",
    ),
    miss: copyOr("socialqr.scan.miss", "Not a runner QR - keep it in frame"),
    found: copyOr("socialqr.scan.found", "🐰 Runner found!"),
    claim: copyOr("socialqr.scan.claim", "Claim connection"),
    again: copyOr("socialqr.scan.again", "Scan another"),
    unavailable: copyOr(
      "socialqr.scan.unavailable",
      "Camera unavailable - use your phone's camera app on the QR instead.",
    ),
    cancel: copyOr("socialqr.scan.cancel", "Done"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/scanner-copy.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/scanner-copy.ts apps/run.human/webapp/src/lib/__tests__/scanner-copy.test.ts
git commit -m "feat(human): extract buildScannerCopy() shared by both scan entry points"
```

---

### Task 3: Landing hero — restructure, three CTAs, modals

**Files:**
- Modify: `src/app/(public)/page.tsx`
- Test: `src/lib/__tests__/landing-quick-actions.test.ts` (create)

**Interfaces:**
- Consumes: `gpxAddRunUrl()` (Task 1), `buildScannerCopy()` (Task 2), `apiUrl()` from `@/lib/api`, `QuickCheckInModal`, `QrScannerModal`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing source-text guard**

`src/lib/__tests__/landing-quick-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text guard for the signed-in landing hero.
 *
 * run.human has no jsdom, so the three quick actions cannot be asserted by
 * rendering. What matters is structural and IS checkable in the source:
 *   - the Add Run href comes from gpxAddRunUrl(), not an inline gpx URL that
 *     could be written against the bare origin (which silently eats ?addrun);
 *   - the Scan button uses its own CMS key, so a CMS edit cannot rename
 *     /whoami's "Connect" button at the same time.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(here, "../../app/(public)/page.tsx");
const src = readFileSync(PAGE, "utf8");

describe("landing quick actions", () => {
  it("sources the Add Run href from gpxAddRunUrl()", () => {
    expect(src).toContain('from "@/lib/gpx-addrun"');
    expect(src).toContain("gpxAddRunUrl()");
  });

  it("never hardcodes a gpx origin in the page", () => {
    expect(src).not.toMatch(/https:\/\/gpx\./);
    expect(src).not.toMatch(/localhost:3003/);
  });

  it("builds scanner copy from the shared module", () => {
    expect(src).toContain('from "@/lib/scanner-copy"');
    expect(src).toContain("buildScannerCopy(");
  });

  it("labels Scan from its own key, not /whoami's Connect key", () => {
    expect(src).toContain("socialqr.scan.button.short");
    expect(src).not.toContain('"socialqr.scan.button"');
  });

  it("mounts both quick-action modals", () => {
    expect(src).toContain("<QuickCheckInModal");
    expect(src).toContain("<QrScannerModal");
  });

  it("never sends isPrivate from the landing page", () => {
    expect(src).not.toContain("isPrivate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/landing-quick-actions.test.ts
```

Expected: FAIL — the first assertion, `expected … to contain 'from "@/lib/gpx-addrun"'`.

- [ ] **Step 3: Add imports and state to the page**

In `src/app/(public)/page.tsx`, extend the lucide import on line 15 and add the new imports after `gpxMapUrl`:

```tsx
import { ChevronRight, MapPin, Footprints, Camera } from "lucide-react";
```

```tsx
import QuickCheckInModal from "@/components/QuickCheckInModal";
import QrScannerModal from "@/components/qr/QrScannerModal";
import { gpxAddRunUrl } from "@/lib/gpx-addrun";
import { buildScannerCopy } from "@/lib/scanner-copy";
import { apiUrl } from "@/lib/api";
```

- [ ] **Step 4: Add the quick-action state and the cosmetic prefetch**

Inside `WelcomeContent`, immediately after the existing `const { t } = useCopy();`:

```tsx
  const [isQuickCheckInOpen, setIsQuickCheckInOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  // Cosmetic only. QuickCheckInModal uses checkinPreference to pick private vs
  // public wording and QrScannerModal uses attendance to show the admin
  // toggle. The check-in POSTs exactly {samples, source} and the server
  // resolves privacy from the stored preference, so a slow or failed fetch can
  // show the wrong wording for a moment but can NEVER make a private runner
  // public. Do not gate the buttons on this.
  const [checkinPreference, setCheckinPreference] = useState<string>();
  const [attendanceAvailable, setAttendanceAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/user"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.user) return;
        setCheckinPreference(data.user.preferences?.checkinPreference);
        setAttendanceAvailable(!!data.user.social?.attendance);
      })
      .catch(() => {
        /* defaults stand; the server still decides the real behaviour */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // t() echoes the raw key when unset, so floor every lookup on a real default.
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };
  const scanCopy = buildScannerCopy(copyOr);
```

- [ ] **Step 5: Restructure the hero so it grows with its content**

Replace the hero `Card`'s opening tag, `Image`, and content `div` opening tag. The card was a fixed `h-[420px]` with the content in an `absolute inset-0` overlay, so content contributed no height and five buttons overflowed. Invert it: the image goes absolute, the content flows.

```tsx
      {/* Full-bleed hero - DC33 group photo, welcome + CTAs inside.
          The photo is absolutely positioned and the content flows, so the card
          grows with the CTA stack on narrow screens; min-h keeps the original
          420px on desktop, where the buttons wrap into rows instead. */}
      <Card isFooterBlurred className="w-full">
        <Image
          removeWrapper
          alt="DC33 defcon.run group at the finish"
          src={asset("/dashboard/defcongroup.jpg")}
          className="absolute inset-0 z-0 w-full h-full object-cover brightness-[.55]"
        />
        <div className="relative z-10 min-h-[420px] flex flex-col items-center justify-center gap-4 text-center px-5 py-10 pb-14">
```

Leave the `<h1>`, the `<p>`, the button wrapper `div`, the closing `</div>`, and the `CardFooter` exactly as they are.

- [ ] **Step 6: Add the three CTAs**

Inside the existing `<div className="flex gap-3 flex-wrap justify-center">`, after the `Routes` button:

```tsx
            {/* The three event-time actions, same flows as /whoami. Ordered by
                how often a runner needs them mid-event. */}
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              startContent={<MapPin className="w-4 h-4" />}
              onPress={() => setIsQuickCheckInOpen(true)}
            >
              {copyOr("checkin.quick.button", "Check-in")}
            </Button>
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              href={gpxAddRunUrl()}
              as="a"
              target="_blank"
              rel="noopener noreferrer"
              startContent={<Footprints className="w-4 h-4" />}
            >
              Add Run
            </Button>
            {/* Its own CMS key on purpose: /whoami names the outcome
                ("Connect") via socialqr.scan.button, this names the mechanism
                because it sits beside four navigational CTAs. Sharing the key
                would let one CMS edit rename both. */}
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              startContent={<Camera className="w-4 h-4" />}
              onPress={() => setIsScannerOpen(true)}
            >
              {copyOr("socialqr.scan.button.short", "Scan")}
            </Button>
```

- [ ] **Step 7: Mount the modals**

As the last children of `WelcomeContent`'s outer `<div className="flex flex-col gap-2.5 py-4 animate-slide-up">`, after the "Run with us" `Card`:

```tsx
      <QuickCheckInModal
        isOpen={isQuickCheckInOpen}
        onClose={() => setIsQuickCheckInOpen(false)}
        checkinPreference={checkinPreference}
      />
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        copy={scanCopy}
        attendanceAvailable={attendanceAvailable}
      />
```

- [ ] **Step 8: Run the guard and the whole suite**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/landing-quick-actions.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/run.human/webapp/src/app/\(public\)/page.tsx apps/run.human/webapp/src/lib/__tests__/landing-quick-actions.test.ts
git commit -m "feat(human): Check-in, Add Run and Scan on the signed-in landing hero"
```

---

### Task 4: Point `/whoami` at the shared modules

**Files:**
- Modify: `src/app/(protected)/whoami/page.tsx`

**Interfaces:**
- Consumes: `gpxAddRunUrl()` (Task 1), `buildScannerCopy()` (Task 2).
- Produces: nothing.

This is a pure refactor. `/whoami`'s rendered output must not change.

- [ ] **Step 1: Add the imports**

After the existing `import { LEADERBOARD_SELF_ENABLED } from '@/lib/leaderboard-launch';`:

```tsx
import { gpxAddRunUrl } from '@/lib/gpx-addrun';
import { buildScannerCopy } from '@/lib/scanner-copy';
```

- [ ] **Step 2: Replace the inline `scanCopy` literal**

Delete the ten-line `const scanCopy = { title: …, cancel: … };` object and replace it with:

```tsx
  const scanCopy = buildScannerCopy(copyOr);
```

- [ ] **Step 3: Replace the inline `gpxAddRunUrl` const**

Delete these four lines:

```tsx
  // ?addrun opens gpx's QuickStart hub (handled in the studio app page).
  const gpxAddRunUrl = isDev
    ? 'http://localhost:3003/studio/app?addrun'
    : `https://gpx.${siteDomain}/${REGION_SHORT}/studio/app?addrun`;
```

The `Add Run` anchor's `href={gpxAddRunUrl}` becomes a call:

```tsx
                href={gpxAddRunUrl()}
```

- [ ] **Step 4: Verify no unused locals remain**

`siteDomain`, `REGION_SHORT` and `isDev` are still used elsewhere in the file (`authBase`, `bunnyHeadUrl`). Confirm:

```bash
cd apps/run.human/webapp && grep -n "siteDomain\|REGION_SHORT\|isDev" "src/app/(protected)/whoami/page.tsx"
```

Expected: each still has at least one use besides its declaration. If any is now unused, delete its declaration.

- [ ] **Step 5: Typecheck and run the full suite**

```bash
cd apps/run.human/webapp && npx tsc --noEmit 2>&1 | tail -20
nvm use 22.12.0 && npx vitest run 2>&1 | tail -20
```

Expected: `tsc` reports only the three known pre-existing errors (`@public/header/dcjack.svg`, `entities/__tests__/checkin.test.ts`, `lib/leaderboard-drill.test.ts`). Vitest: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/app/\(protected\)/whoami/page.tsx
git commit -m "refactor(human): /whoami consumes the shared gpx-addrun and scanner-copy modules"
```

---

### Task 5: Copy catalog, build, and lint baseline

**Files:**
- Modify: `src/lib/copy-catalog.ts` (only if it enumerates CMS keys — verify first)
- Test: `src/lib/__tests__/copy-catalog-human.test.ts` (existing; may need the new key)

**Interfaces:**
- Consumes: everything above.
- Produces: a releasable build.

- [ ] **Step 1: Check whether the copy catalog must learn the new key**

```bash
cd apps/run.human/webapp && grep -rn "socialqr.scan.button" src/lib/copy-catalog* src/lib/__tests__/copy-catalog-human.test.ts 2>/dev/null
```

If `socialqr.scan.button` appears in a catalog list, add `socialqr.scan.button.short` beside it with default `Scan` and a description of "Landing-page camera CTA (profile says Connect)". If it does not appear, the catalog does not enumerate these keys and no change is needed — record which it was.

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/run.human/webapp && nvm use 22.12.0 && npx vitest run 2>&1 | tail -25
```

Expected: all suites pass; the new files add 14 tests. Do not pipe through `tail` alone when judging health — read the summary line for the failed count.

- [ ] **Step 3: Production build**

```bash
cd apps/run.human/webapp && npm run build 2>&1 | tail -30
```

Expected: build succeeds. A green build is not proof CSS shipped, but this task changes no CSS.

- [ ] **Step 4: Lint baseline, then lint the changed files**

```bash
cd apps/run.human/webapp
git stash -q
npx eslint "src/app/(public)/page.tsx" "src/app/(protected)/whoami/page.tsx" 2>&1 | tail -20   # BASELINE
git stash pop -q
npx eslint "src/app/(public)/page.tsx" "src/app/(protected)/whoami/page.tsx" src/lib/gpx-addrun.ts src/lib/scanner-copy.ts 2>&1 | tail -20
```

Expected: no errors beyond the baseline set. `main` already ships React Compiler errors here; only newly-introduced ones matter.

- [ ] **Step 5: Commit any catalog change**

```bash
git add -A apps/run.human/webapp/src/lib
git commit -m "chore(human): register socialqr.scan.button.short in the copy catalog"
```

Skip this commit if Step 1 found nothing to change.

---

### Task 6: Ship

**Files:** none (release mechanics).

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/landing-quick-actions
gh pr create --title "feat(human): landing-page quick actions — Check-in, Add Run, Scan" --body "<summary + test plan>"
```

- [ ] **Step 2: Merge**

```bash
gh pr merge --squash --admin
```

A failure reading `fatal: 'main' is already used by worktree` is only the local branch-delete step. Confirm the merge with `gh pr view --json state` before reacting.

- [ ] **Step 3: Build and publish**

```bash
gh workflow run buildpub.yml -f apps=run.human -f regions=use1 -f deploy=false
```

`buildpub` auto-merges its own version-bump Release PR, so the deploy below takes `pr_number=skip`.

- [ ] **Step 4: Deploy**

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true
gh run watch <run-id>
```

- [ ] **Step 5: Verify live**

```bash
curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'
```

Expected: the new version. CI going green is not proof the new task is serving — ECS does a rolling replace, so re-check until the version flips.

---

## Self-Review

**Spec coverage:** hero restructure → Task 3 Step 5. Three CTAs → Task 3 Step 6. `gpx-addrun` → Task 1. `scanner-copy` → Task 2. `/whoami` refactor → Task 4. CMS keys → Task 3 Step 6 + Task 5 Step 1. `/api/user` prefetch → Task 3 Step 4. Testing → Tasks 1–3 + Task 5 Step 2. Error handling is inherited from the unmodified modals, as the spec states.

**Type consistency:** `gpxAddRunUrl()` is a zero-arg call at both call sites (Task 3 Step 6, Task 4 Step 3) — note `/whoami` currently uses it as a bare const, which Task 4 Step 3 explicitly converts. `buildScannerCopy(copyOr)` takes the same `copyOr` signature that already exists in both files. `ScannerCopy` is imported as a type only, so no client component is pulled into the node-environment test.
