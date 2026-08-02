# Whoami Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relabel the profile's camera button to `Connect`, add a one-tap `Check-in` beside it, and make the Add-Radio modal close when the runner leaves for the flasher.

**Architecture:** Every decision worth asserting is pushed into two pure modules (`lib/gps-samples`, `lib/quick-checkin`) that node-environment Vitest can cover. A `useGpsSamples` hook wraps the sampling lifecycle so the existing `CheckInModal` and the new `QuickCheckInModal` share one implementation. The quick modal deliberately POSTs no privacy or pin fields — the API already resolves both from the runner's profile, so the fast path cannot drift.

**Tech Stack:** Next.js 16, React 19, HeroUI 2.8, lucide-react, Vitest 4 (node env, no jsdom).

## Global Constraints

- Work in `apps/run.human/webapp`. All paths below are relative to that directory.
- **Node 22.12+ is required for Vitest.** Run `source ~/.nvm/nvm.sh && nvm use 22.12.0` in any shell before `npx vitest`. The host default is v22.1.0 and will fail.
- There is no `test` npm script. Run tests with `npx vitest run <path>`.
- **No jsdom, no `@testing-library/react`. Do not add them.** Tests are node-environment only. Never write a test that renders a React component.
- Test files live in `src/<dir>/__tests__/<name>.test.ts`, mirroring the 115 existing suites.
- User-facing strings go through `copyOr(key, fallback)` (CMS-backed) in components. Pure modules return the fallback strings directly and the component passes them through `copyOr`.
- Comments explain *why*, not *what* — match the density of the surrounding file.
- ASCII only in code comments and copy (the codebase uses `--` not an em dash in user-facing strings).
- Commit after every task.

---

### Task 1: Pure GPS sampling helpers

**Files:**
- Create: `src/lib/gps-samples.ts`
- Test: `src/lib/__tests__/gps-samples.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type GpsSample = { latitude: number; longitude: number; accuracy: number; timestamp: number }`, `toGpsSample(position: GeolocationPosition, now: number): GpsSample`, `bestAccuracyOf(samples: GpsSample[]): number | null`, `SAMPLE_TARGET: 3`, `SAMPLE_INTERVAL_MS: 667`, `GEO_OPTIONS: PositionOptions`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/gps-samples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toGpsSample,
  bestAccuracyOf,
  SAMPLE_TARGET,
  SAMPLE_INTERVAL_MS,
  GEO_OPTIONS,
  type GpsSample,
} from "../gps-samples";

const sample = (accuracy: number): GpsSample => ({
  latitude: 36.17,
  longitude: -115.14,
  accuracy,
  timestamp: 1_000,
});

describe("toGpsSample", () => {
  it("maps a GeolocationPosition onto the wire shape", () => {
    const position = {
      coords: { latitude: 36.1699, longitude: -115.1398, accuracy: 12.5 },
    } as GeolocationPosition;

    expect(toGpsSample(position, 1_700_000_000_000)).toEqual({
      latitude: 36.1699,
      longitude: -115.1398,
      accuracy: 12.5,
      timestamp: 1_700_000_000_000,
    });
  });
});

describe("bestAccuracyOf", () => {
  it("returns the smallest accuracy -- the tightest fix wins", () => {
    expect(bestAccuracyOf([sample(30), sample(8), sample(19)])).toBe(8);
  });

  it("returns null for an empty list rather than Infinity", () => {
    expect(bestAccuracyOf([])).toBeNull();
  });
});

describe("sampling constants", () => {
  // The warm-start UX assumes ~2s to a fix. Pin the numbers so a future
  // tweak has to be deliberate.
  it("collects three samples spaced 667ms apart", () => {
    expect(SAMPLE_TARGET).toBe(3);
    expect(SAMPLE_INTERVAL_MS).toBe(667);
  });

  it("asks for high accuracy with a 10s ceiling", () => {
    expect(GEO_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 10000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
source ~/.nvm/nvm.sh && nvm use 22.12.0
npx vitest run src/lib/__tests__/gps-samples.test.ts
```

Expected: FAIL — `Cannot find module '../gps-samples'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/gps-samples.ts`:

```ts
/**
 * Pure parts of the GPS check-in sampling loop, split out from the React hook
 * so they are testable in the node environment (this app has no jsdom).
 */

export interface GpsSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

/** Samples averaged into one check-in. */
export const SAMPLE_TARGET = 3;

/** Gap between samples -- three fixes land in roughly two seconds. */
export const SAMPLE_INTERVAL_MS = 667;

export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
};

export function toGpsSample(position: GeolocationPosition, now: number): GpsSample {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: now,
  };
}

/** Tightest fix in the batch, or null when nothing has landed yet. */
export function bestAccuracyOf(samples: GpsSample[]): number | null {
  if (samples.length === 0) return null;
  return Math.min(...samples.map((s) => s.accuracy));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/gps-samples.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gps-samples.ts src/lib/__tests__/gps-samples.test.ts
git commit -m "feat(human): extract pure GPS sampling helpers"
```

---

### Task 2: Pure quick check-in logic

**Files:**
- Create: `src/lib/quick-checkin.ts`
- Test: `src/lib/__tests__/quick-checkin.test.ts`

**Interfaces:**
- Consumes: `GpsSample` from `src/lib/gps-samples.ts` (Task 1).
- Produces:
  - `QUICK_CHECKIN_SOURCE: 'Web Quick'`
  - `quickCheckInCopy(preference?: string): { isPrivate: boolean; titleKey: string; titleFallback: string; bodyKey: string; bodyFallback: string }`
  - `buildQuickCheckInBody(samples: GpsSample[]): { samples: GpsSample[]; source: string }`
  - `quickCheckInError(status: number): string`
  - `GPS_UNAVAILABLE_MESSAGE: string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/quick-checkin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  quickCheckInCopy,
  buildQuickCheckInBody,
  quickCheckInError,
  QUICK_CHECKIN_SOURCE,
  GPS_UNAVAILABLE_MESSAGE,
} from "../quick-checkin";
import type { GpsSample } from "../gps-samples";

const SAMPLES: GpsSample[] = [
  { latitude: 36.17, longitude: -115.14, accuracy: 10, timestamp: 1 },
];

describe("quickCheckInCopy", () => {
  it("speaks privately when the runner's preference is private", () => {
    const copy = quickCheckInCopy("private");
    expect(copy.isPrivate).toBe(true);
    expect(copy.titleFallback).toBe("Fast private check-in");
    expect(copy.bodyFallback).toBe("Saved to your history only.");
    expect(copy.titleKey).toBe("checkin.quick.title.private");
    expect(copy.bodyKey).toBe("checkin.quick.body.private");
  });

  it.each([undefined, "public", "", "PRIVATE", "anything-else"])(
    "defaults to public for %p",
    (preference) => {
      const copy = quickCheckInCopy(preference);
      expect(copy.isPrivate).toBe(false);
      expect(copy.titleFallback).toBe("Fast public check-in");
      expect(copy.bodyFallback).toBe("Posts your location to the live map.");
      expect(copy.titleKey).toBe("checkin.quick.title.public");
      expect(copy.bodyKey).toBe("checkin.quick.body.public");
    },
  );
});

describe("buildQuickCheckInBody", () => {
  it("sends the samples under the quick source label", () => {
    expect(buildQuickCheckInBody(SAMPLES)).toEqual({
      samples: SAMPLES,
      source: "Web Quick",
    });
    expect(QUICK_CHECKIN_SOURCE).toBe("Web Quick");
  });

  // The whole privacy guarantee of the fast path: the route resolves
  // isPrivate and the pin from the runner's profile, so sending either
  // here would let the quick modal silently diverge from their settings.
  it("omits isPrivate, pinIcon and pinColor entirely", () => {
    const body = buildQuickCheckInBody(SAMPLES);
    expect(Object.keys(body).sort()).toEqual(["samples", "source"]);
    expect("isPrivate" in body).toBe(false);
    expect("pinIcon" in body).toBe(false);
    expect("pinColor" in body).toBe(false);
  });
});

describe("quickCheckInError", () => {
  it("names the quota on 429", () => {
    expect(quickCheckInError(429)).toBe("Check-in limit reached for today");
  });

  it.each([400, 401, 500, 503])("falls back to the generic message on %i", (status) => {
    expect(quickCheckInError(status)).toBe("Something went wrong");
  });

  it("matches the wording the full check-in modal uses for GPS failure", () => {
    expect(GPS_UNAVAILABLE_MESSAGE).toBe(
      "Location unavailable -- enable GPS and try again",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/quick-checkin.test.ts
```

Expected: FAIL — `Cannot find module '../quick-checkin'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/quick-checkin.ts`:

```ts
import type { GpsSample } from "./gps-samples";

/**
 * Decisions behind the one-tap check-in, kept out of the component so they
 * can be asserted (this app tests in the node environment only).
 */

/** Distinct from 'Web GPS' and 'Admin Manual' so fast-path use is measurable. */
export const QUICK_CHECKIN_SOURCE = "Web Quick";

/** Same wording the full check-in modal uses, so the two speak with one voice. */
export const GPS_UNAVAILABLE_MESSAGE =
  "Location unavailable -- enable GPS and try again";

export interface QuickCheckInCopy {
  isPrivate: boolean;
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
}

/**
 * The quick modal has no privacy toggle, so it must say plainly which kind of
 * check-in the button will make. Only an exact 'private' counts -- the same
 * comparison the check-ins route makes when it resolves the default.
 */
export function quickCheckInCopy(preference?: string): QuickCheckInCopy {
  const isPrivate = preference === "private";
  return isPrivate
    ? {
        isPrivate,
        titleKey: "checkin.quick.title.private",
        titleFallback: "Fast private check-in",
        bodyKey: "checkin.quick.body.private",
        bodyFallback: "Saved to your history only.",
      }
    : {
        isPrivate,
        titleKey: "checkin.quick.title.public",
        titleFallback: "Fast public check-in",
        bodyKey: "checkin.quick.body.public",
        bodyFallback: "Posts your location to the live map.",
      };
}

/**
 * Deliberately carries no isPrivate and no pin: POST /api/checkins already
 * falls back to the runner's preference and profile pin, so omitting them is
 * what keeps the fast path honest.
 */
export function buildQuickCheckInBody(samples: GpsSample[]): {
  samples: GpsSample[];
  source: string;
} {
  return { samples, source: QUICK_CHECKIN_SOURCE };
}

export function quickCheckInError(status: number): string {
  return status === 429
    ? "Check-in limit reached for today"
    : "Something went wrong";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/quick-checkin.test.ts
```

Expected: PASS, 12 tests (the `it.each` blocks expand).

- [ ] **Step 5: Commit**

```bash
git add src/lib/quick-checkin.ts src/lib/__tests__/quick-checkin.test.ts
git commit -m "feat(human): pure quick check-in copy, body and error mapping"
```

---

### Task 3: `useGpsSamples` hook, and refactor `CheckInModal` onto it

**Files:**
- Create: `src/hooks/useGpsSamples.ts`
- Modify: `src/components/CheckInModal.tsx`

**Interfaces:**
- Consumes: everything from `src/lib/gps-samples.ts` (Task 1).
- Produces: `useGpsSamples(isActive: boolean): { phase: 'collecting' | 'ready' | 'error'; samples: GpsSample[]; samplesRef: MutableRefObject<GpsSample[]>; sampleCount: number; bestAccuracy: number | null; restart: () => void }`.

**Why `samplesRef` is returned alongside `samples`:** the existing modal submits from a ref (`samplesRef.current`) to avoid a stale closure in the async submit handler, while rendering from state. Both consumers need that same split, so the hook exposes both.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useGpsSamples.ts`:

```ts
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  type GpsSample,
  toGpsSample,
  bestAccuracyOf,
  SAMPLE_TARGET,
  SAMPLE_INTERVAL_MS,
  GEO_OPTIONS,
} from '@/lib/gps-samples';

export type GpsPhase = 'collecting' | 'ready' | 'error';

/**
 * Collects SAMPLE_TARGET GPS fixes while `isActive`, then reports 'ready'.
 * Extracted from CheckInModal so the full and quick check-in modals share one
 * sampling implementation -- a GPS bug now has a single place to be fixed.
 *
 * Every async callback is guarded by activeRef so a closed modal never writes
 * state, and all pending timers are cleared on deactivate and on unmount.
 */
export function useGpsSamples(isActive: boolean) {
  const [phase, setPhase] = useState<GpsPhase>('collecting');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [bestAccuracy, setBestAccuracy] = useState<number | null>(null);

  const activeRef = useRef(false);
  const samplesRef = useRef<GpsSample[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const collect = useCallback(() => {
    if (!navigator.geolocation) {
      setPhase('error');
      return;
    }

    let collected = 0;

    const takeSample = () => {
      if (!activeRef.current) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!activeRef.current) return;

          samplesRef.current = [...samplesRef.current, toGpsSample(position, Date.now())];
          collected++;
          setSamples([...samplesRef.current]);
          setSampleCount(collected);

          if (collected >= SAMPLE_TARGET) {
            setBestAccuracy(bestAccuracyOf(samplesRef.current));
            setPhase('ready');
          } else {
            timeoutsRef.current.push(setTimeout(takeSample, SAMPLE_INTERVAL_MS));
          }
        },
        () => {
          if (!activeRef.current) return;
          setPhase('error');
        },
        GEO_OPTIONS,
      );
    };

    takeSample();
  }, []);

  const reset = useCallback(() => {
    setPhase('collecting');
    setSamples([]);
    setSampleCount(0);
    setBestAccuracy(null);
    samplesRef.current = [];
  }, []);

  /** Throw away what we have and sample again -- backs the retry buttons. */
  const restart = useCallback(() => {
    clearTimeouts();
    reset();
    timeoutsRef.current.push(setTimeout(() => collect(), 100));
  }, [clearTimeouts, reset, collect]);

  useEffect(() => {
    if (isActive) {
      activeRef.current = true;
      reset();
      timeoutsRef.current.push(setTimeout(() => collect(), 100));
    } else {
      activeRef.current = false;
      clearTimeouts();
    }

    return () => {
      clearTimeouts();
    };
  }, [isActive, reset, collect, clearTimeouts]);

  return { phase, samples, samplesRef, sampleCount, bestAccuracy, restart };
}
```

- [ ] **Step 2: Rewire `CheckInModal` to the hook**

In `src/components/CheckInModal.tsx`:

1. Delete the local `GpsSample` interface and import the type plus the hook:

```ts
import { useGpsSamples } from '@/hooks/useGpsSamples';
import { SAMPLE_TARGET } from '@/lib/gps-samples';
```

2. Delete these local pieces entirely — they now live in the hook: the `samples`,
   `sampleCount`, `bestAccuracy` state; the `isOpenRef`, `timeoutsRef`, `samplesRef` refs;
   `clearTimeouts`; `collectGps`; and the sampling half of `resetState`.

3. Keep `phase` as local state but derive it from the hook. The modal's `Phase` type has
   states the hook does not know about (`submitting`, `success`), so keep a local
   `submitPhase` and compose:

```ts
type SubmitPhase = 'idle' | 'submitting' | 'success' | 'error';

const { phase: gpsPhase, samples, samplesRef, sampleCount, bestAccuracy, restart } =
  useGpsSamples(isOpen);
const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');

// The hook owns GPS; local state owns the submit. 'error' from either wins.
const phase: Phase =
  submitPhase !== 'idle'
    ? (submitPhase as Phase)
    : gpsPhase === 'error'
      ? 'error'
      : gpsPhase;
```

4. `resetState` keeps only the non-GPS resets (`isPrivate`, `quotaRemaining`,
   `errorMessage`, `manualCoords`, `showManualCoords`) plus `setSubmitPhase('idle')`.

5. The `useEffect` on `isOpen` keeps the pin-options fetch and the `resetState()` call but
   drops the GPS start and the timeout bookkeeping — the hook does both.

6. `setPhase('error')` for GPS failure is gone; set `errorMessage` from the hook's error
   phase instead:

```ts
useEffect(() => {
  if (gpsPhase === 'error') setErrorMessage(GPS_UNAVAILABLE_MESSAGE);
}, [gpsPhase]);
```

   with `import { GPS_UNAVAILABLE_MESSAGE } from '@/lib/quick-checkin';`

7. `handleSubmit` keeps its body but uses `setSubmitPhase('submitting' | 'success' | 'error')`
   instead of `setPhase(...)`, and still reads `samplesRef.current`.

8. `handleRetry` becomes:

```ts
const handleRetry = () => {
  if (samplesRef.current.length === SAMPLE_TARGET) {
    handleSubmit(); // fix is good; the submit is what failed
  } else {
    setSubmitPhase('idle');
    setErrorMessage(null);
    restart();
  }
};
```

9. Replace the two hardcoded `3`s in the progress UI (`(sampleCount / 3) * 100` and
   `` `${sampleCount}/3` ``) with `SAMPLE_TARGET`.

Everything else in the file — the map preview, `zoomForAccuracy`, the pin picker, the
privacy select, the admin manual-coords branch, `MANUAL_ACCURACY_M`, `parseLatLng` — is
untouched.

- [ ] **Step 3: Typecheck and build**

```bash
source ~/.nvm/nvm.sh && nvm use 22.12.0
npx tsc --noEmit
```

Expected: no errors from `CheckInModal.tsx` or `useGpsSamples.ts`.

- [ ] **Step 4: Run the full suite for regressions**

```bash
npx vitest run
```

Expected: all suites pass, same count as before plus Tasks 1-2.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGpsSamples.ts src/components/CheckInModal.tsx
git commit -m "refactor(human): share GPS sampling between check-in modals via useGpsSamples"
```

---

### Task 4: `QuickCheckInModal`

**Files:**
- Create: `src/components/QuickCheckInModal.tsx`

**Interfaces:**
- Consumes: `useGpsSamples` (Task 3); `quickCheckInCopy`, `buildQuickCheckInBody`, `quickCheckInError`, `GPS_UNAVAILABLE_MESSAGE` (Task 2); `apiUrl` from `@/lib/api`; `useCopy` from `@/components/CopyProvider`.
- Produces: default export `QuickCheckInModal({ isOpen, onClose, checkinPreference }: QuickCheckInModalProps)`.

- [ ] **Step 1: Write the component**

Create `src/components/QuickCheckInModal.tsx`:

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button,
} from '@heroui/react';
import { MapPin, Check, AlertCircle } from 'lucide-react';
import { useGpsSamples } from '@/hooks/useGpsSamples';
import {
  quickCheckInCopy,
  buildQuickCheckInBody,
  quickCheckInError,
  GPS_UNAVAILABLE_MESSAGE,
} from '@/lib/quick-checkin';
import { useCopy } from '@/components/CopyProvider';
import { apiUrl } from '@/lib/api';

interface QuickCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'private' means this runner's check-ins default to private. */
  checkinPreference?: string;
}

type Status = 'confirm' | 'submitting' | 'success' | 'error';

/**
 * One-tap check-in: confirm, and go. GPS sampling starts the moment the modal
 * opens so the fix is usually already in hand by the time the runner presses
 * the button -- the "warm start".
 *
 * Everything configurable (privacy, pin) is deliberately absent; the runner's
 * profile decides, server-side. The full CheckInModal behind the Check-ins
 * card is still the way to override either for a single check-in.
 */
export default function QuickCheckInModal({
  isOpen, onClose, checkinPreference,
}: QuickCheckInModalProps) {
  const { t } = useCopy();
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };

  const copy = quickCheckInCopy(checkinPreference);
  const { phase: gpsPhase, samplesRef, restart } = useGpsSamples(isOpen);

  const [status, setStatus] = useState<Status>('confirm');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set the instant the runner commits, so a confirm pressed during sampling
  // arms exactly one deferred submit -- never two.
  const armedRef = useRef(false);
  const openRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    openRef.current = isOpen;
    if (isOpen) {
      setStatus('confirm');
      setErrorMessage(null);
      armedRef.current = false;
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isOpen]);

  const submit = useCallback(async () => {
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const res = await fetch(apiUrl('/api/checkins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQuickCheckInBody(samplesRef.current)),
      });
      if (!openRef.current) return;

      if (!res.ok) {
        armedRef.current = false;
        setErrorMessage(quickCheckInError(res.status));
        setStatus('error');
        return;
      }

      setStatus('success');
      // Same signal the full modal sends: the Check-ins card expands and refetches.
      window.dispatchEvent(new Event('checkin-created'));
      closeTimerRef.current = setTimeout(() => {
        if (openRef.current) onClose();
      }, 1500);
    } catch {
      if (!openRef.current) return;
      armedRef.current = false;
      setErrorMessage('Something went wrong');
      setStatus('error');
    }
  }, [samplesRef, onClose]);

  const handleConfirm = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    if (gpsPhase === 'ready') {
      submit();
    } else {
      setStatus('submitting'); // spinner while the fix lands; effect below fires
    }
  };

  // Warm start: a confirm pressed before the fix landed submits as soon as it does.
  useEffect(() => {
    if (armedRef.current && status === 'submitting' && gpsPhase === 'ready') {
      submit();
    }
  }, [gpsPhase, status, submit]);

  // A GPS failure while waiting cancels the armed submit -- there is nothing to send.
  useEffect(() => {
    if (gpsPhase !== 'error') return;
    armedRef.current = false;
    setErrorMessage(GPS_UNAVAILABLE_MESSAGE);
    setStatus('error');
  }, [gpsPhase]);

  const handleRetry = () => {
    setErrorMessage(null);
    armedRef.current = false;
    setStatus('confirm');
    if (gpsPhase === 'error') restart();
  };

  return (
    <Modal
      size="sm"
      placement="center"
      backdrop="blur"
      isOpen={isOpen}
      isDismissable={status !== 'submitting'}
      onClose={() => { if (status !== 'submitting') onClose(); }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              {copyOr(copy.titleKey, copy.titleFallback)}
            </ModalHeader>
            <ModalBody>
              {status === 'success' ? (
                <div className="flex items-center gap-2 py-2 text-success">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">
                    {copyOr('checkin.quick.done', 'Checked in!')}
                  </span>
                </div>
              ) : status === 'error' ? (
                <div className="flex items-start gap-2 py-2 text-danger">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="text-sm">{errorMessage}</span>
                </div>
              ) : (
                <p className="text-sm text-default-600 py-2">
                  {copyOr(copy.bodyKey, copy.bodyFallback)}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              {status === 'error' ? (
                <>
                  <Button variant="light" onPress={onClose}>
                    {copyOr('checkin.quick.cancel', 'Cancel')}
                  </Button>
                  <Button color="primary" onPress={handleRetry}>
                    {copyOr('checkin.quick.retry', 'Try again')}
                  </Button>
                </>
              ) : status === 'success' ? null : (
                <>
                  <Button
                    variant="light"
                    isDisabled={status === 'submitting'}
                    onPress={onClose}
                  >
                    {copyOr('checkin.quick.cancel', 'Cancel')}
                  </Button>
                  <Button
                    color="primary"
                    size="lg"
                    isLoading={status === 'submitting'}
                    onPress={handleConfirm}
                  >
                    {copyOr('checkin.quick.confirm', 'Check in')}
                  </Button>
                </>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Confirm `useCopy` exposes `t` the way this assumes**

```bash
grep -n "export function useCopy\|const t\b\|t:" src/components/CopyProvider.tsx | head
```

Expected: `useCopy()` returns an object with `t(key: string): string`. If the shape
differs, match the call site in `src/app/(protected)/whoami/page.tsx`, which is the
reference usage.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/QuickCheckInModal.tsx
git commit -m "feat(human): one-tap quick check-in modal"
```

---

### Task 5: Action bar — `Connect` and `Check-in`

**Files:**
- Modify: `src/app/(protected)/whoami/page.tsx`

**Interfaces:**
- Consumes: `QuickCheckInModal` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: Add the import and state**

Add to the imports:

```ts
import QuickCheckInModal from '@/components/QuickCheckInModal';
```

Add `MapPin` to the existing `lucide-react` import list.

Beside `const [isScannerOpen, setIsScannerOpen] = useState(false);` add:

```ts
const [isQuickCheckInOpen, setIsQuickCheckInOpen] = useState(false);
```

- [ ] **Step 2: Relabel the camera button**

In the action bar, change the camera button's fallback only:

```tsx
{copyOr('socialqr.scan.button', 'Connect')}
```

Update the comment above it to say why — the act, not the mechanism:

```tsx
{/* The camera, promoted out of the collapsed QR panel -- scanning another
    runner is the headline social act, not a sub-feature of your own QR.
    Labelled for the outcome ("Connect"), not the mechanism ("Scan"). */}
```

- [ ] **Step 3: Add the Check-in button after it**

Immediately after the `Connect` `<Button>` and before the Leaderboard block:

```tsx
{/* One tap to mark that you were here. No privacy or pin controls: the
    server applies this runner's profile defaults, and the Check-ins card
    "+" is still the way to override either for a single check-in. */}
<Button
  color="primary"
  variant="bordered"
  radius="full"
  className="font-semibold"
  startContent={<MapPin className="w-4 h-4 sm:w-5 sm:h-5" />}
  onPress={() => setIsQuickCheckInOpen(true)}
>
  {copyOr('checkin.quick.button', 'Check-in')}
</Button>
```

- [ ] **Step 4: Mount the modal**

Directly after the closing `</Card>` of the identity card, add:

```tsx
<QuickCheckInModal
  isOpen={isQuickCheckInOpen}
  onClose={() => setIsQuickCheckInOpen(false)}
  checkinPreference={userData?.preferences?.checkinPreference}
/>
```

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit && npx next build
```

Expected: build succeeds. `next build` rewrites `next-env.d.ts` — if it shows as
modified, leave it; do not commit an unrelated change to it unless it truly differs.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(protected)/whoami/page.tsx"
git commit -m "feat(human): Connect label and one-tap Check-in in the profile action bar"
```

---

### Task 6: Close the Add-Radio modal on the way to the flasher

**Files:**
- Modify: `src/components/profile/MeshtasticRadios.tsx` (the Add Radio Modal, around line 453)

**Interfaces:**
- Consumes: existing `closeAdd` from `useDisclosure()` in the same component.
- Produces: nothing.

- [ ] **Step 1: Add `onPress` to the Goto Flash button**

The button stays an anchor so the new tab still opens; `onPress` fires on activation and
dismisses the modal behind it.

```tsx
<Button
  color="primary"
  size="sm"
  as="a"
  href={flashUrl}
  target="_blank"
  rel="noopener noreferrer"
  // The flasher opens in a new tab; drop this modal so the runner does not
  // come back to a dialog they are done with.
  onPress={closeAdd}
  startContent={<Zap className="h-4 w-4" />}
  endContent={<ExternalLink className="h-3 w-3" />}
  className="shrink-0"
>
  Goto Flash
</Button>
```

Do **not** touch the other Flash button in the radio-list empty state (around line 656) —
it is not inside a modal.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/MeshtasticRadios.tsx
git commit -m "fix(human): close Add Radio modal when opening the flasher"
```

---

### Task 7: Full verification

**Files:** none modified.

- [ ] **Step 1: Full test suite**

```bash
source ~/.nvm/nvm.sh && nvm use 22.12.0
npx vitest run 2>&1 | tail -20
```

Expected: every suite passes. Read the summary line directly — do not pipe through
`grep`, and do not trust a truncated tail that hides a failure count.

- [ ] **Step 2: Lint**

```bash
npx eslint src/components/QuickCheckInModal.tsx src/hooks/useGpsSamples.ts src/lib/quick-checkin.ts src/lib/gps-samples.ts "src/app/(protected)/whoami/page.tsx" src/components/CheckInModal.tsx src/components/profile/MeshtasticRadios.tsx
```

Expected: clean.

- [ ] **Step 3: Production build**

```bash
npx next build 2>&1 | tail -25
```

Expected: compiled successfully.

- [ ] **Step 4: Manual pass against a dev server**

```bash
PORT=3001 npm run dev
```

Then at `http://localhost:3001/whoami`, confirm each:

1. Action bar reads `Add Run` · `Connect` · `Check-in` (· `Leaderboard` if admin), and
   wraps without overflow at a 375px-wide viewport.
2. `Connect` still opens the QR scanner.
3. `Check-in` opens the confirm; the title matches the account's check-in preference.
4. Confirm → success → the Check-ins card expands and the new check-in appears.
5. Press `Check in` the instant the modal opens (before the fix lands) → one check-in is
   created, not two. Verify the count increments by exactly one.
6. Deny location permission → error state, `Try again` re-samples.
7. `+` on the Check-ins card → the full modal is unchanged: map preview, pin picker, and
   privacy select all still work and a check-in lands.
8. Meshtastic `+` → `Goto Flash` → the flasher opens in a new tab **and** the modal is
   gone on return.

- [ ] **Step 5: Commit any fixes from the manual pass**

Only if the manual pass turned something up.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `Scan a runner` → `Connect` | 5 |
| New `Check-in` action-bar button | 5 |
| `useGpsSamples` extraction, `CheckInModal` refactored onto it | 3 |
| Pure GPS helpers testable in node env | 1 |
| Copy follows `checkinPreference` | 2 (logic), 4 (render) |
| POST carries only `samples` + `source: 'Web Quick'` | 2 (asserted), 4 (used) |
| Warm start; confirm-before-fix submits once | 4 |
| `checkin-created` dispatch, 1500ms auto-close | 4 |
| Error strings for GPS / 429 / generic | 2 (mapping), 4 (render) |
| Add-Radio modal closes on Goto Flash | 6 |
| Manual pass covering what tests cannot | 7 |

No gaps.

**Placeholder scan:** none — every code step carries the actual code.

**Type consistency:** `GpsSample` is defined once in Task 1 and imported by Tasks 2, 3,
and 4. `SAMPLE_TARGET` is used in Tasks 1 and 3. `GPS_UNAVAILABLE_MESSAGE` is defined in
Task 2 and consumed in Tasks 3 and 4. The hook's return shape declared in Task 3's
Interfaces matches its destructuring in Tasks 3 and 4 (`phase` aliased to `gpsPhase` in
both consumers). `quickCheckInCopy`'s return fields (`titleKey`, `titleFallback`,
`bodyKey`, `bodyFallback`, `isPrivate`) match the Task 4 render exactly.
