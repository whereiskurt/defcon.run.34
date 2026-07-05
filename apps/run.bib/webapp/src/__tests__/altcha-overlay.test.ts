import { describe, it, expect, beforeEach } from "vitest";

import { begin, end, subscribe } from "@/lib/altcha-overlay";

/**
 * The overlay in-flight store is a module-level singleton (mirrors
 * pending-bib-save / rain-store), so its `count` persists across test cases.
 * Drain it to zero before each test so every case starts from a known,
 * not-busy baseline. `end()` is floored at 0, so over-draining is a no-op.
 */
function drainToZero(): void {
  for (let i = 0; i < 128; i++) end();
}

describe("altcha-overlay in-flight store", () => {
  beforeEach(() => drainToZero());

  it("notifies busy=true on 0→1 and busy=false on 1→0", () => {
    const seen: boolean[] = [];
    const unsub = subscribe((b) => seen.push(b));
    begin();
    end();
    unsub();
    expect(seen).toEqual([true, false]);
  });

  it("stays busy through nested begin/begin/end/end until the final end", () => {
    let busy: boolean | undefined;
    const unsub = subscribe((b) => (busy = b));

    begin();
    expect(busy).toBe(true);
    begin();
    expect(busy).toBe(true); // count is 2
    end();
    expect(busy).toBe(true); // count is 1 — still one PoW in flight
    end();
    expect(busy).toBe(false); // count is 0 — overlay dismisses

    unsub();
  });

  it("never drives the count below zero — a spare end() stays not-busy", () => {
    let busy: boolean | undefined;
    const unsub = subscribe((b) => (busy = b));

    end(); // count already 0 → floored, stays 0
    expect(busy).toBe(false);
    begin(); // 0→1 must still flip busy (proves the floor did not underflow)
    expect(busy).toBe(true);
    end();
    expect(busy).toBe(false);

    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    let calls = 0;
    const unsub = subscribe(() => calls++);
    begin();
    end();
    const afterActive = calls;
    unsub();
    begin();
    end();
    expect(calls).toBe(afterActive);
  });
});
