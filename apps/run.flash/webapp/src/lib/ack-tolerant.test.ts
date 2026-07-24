import { describe, it, expect, vi, afterEach } from "vitest";
import { awaitAckTolerant } from "./ack-tolerant";

afterEach(() => {
  vi.useRealTimers();
});

describe("awaitAckTolerant", () => {
  it("resolves immediately when the ack arrives (2.7 behavior)", async () => {
    const start = Date.now();
    await awaitAckTolerant(Promise.resolve(42), "test", 5000);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("resolves after the timeout when no ack ever arrives (2.8 behavior)", async () => {
    vi.useFakeTimers();
    const never = new Promise(() => {});
    const p = awaitAckTolerant(never, "test", 3000);
    let settled = false;
    p.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(true);
  });

  it("tolerates a rejected ack promise without throwing", async () => {
    await expect(
      awaitAckTolerant(Promise.reject(new Error("TIMEOUT")), "test", 1000)
    ).resolves.toBeUndefined();
  });

  it("swallows a late rejection after the timeout already won", async () => {
    vi.useFakeTimers();
    let rejectLate: (e: Error) => void = () => {};
    const late = new Promise((_, rej) => {
      rejectLate = rej;
    });
    const p = awaitAckTolerant(late, "test", 1000);
    await vi.advanceTimersByTimeAsync(1100);
    await p; // resolved via timeout
    rejectLate(new Error("lib 60s TIMEOUT"));
    // No unhandled rejection: the .then(_, handler) chain caught it.
    await vi.advanceTimersByTimeAsync(10);
  });
});
