import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CR-01 regression: toggling the scoring window OFF on edit must CLEAR the stored
 * window, not silently preserve it. The write path expresses this as an explicit
 * `null` sentinel that `upsertCtf` maps to an ElectroDB attribute REMOVE. A plain
 * `.set()` with the key omitted is no-clobber, which is the bug — the old window
 * would survive and keep gating the flag while the UI claims "Scorable any time."
 *
 * We mock the two entity modules so the removal is observable without a real
 * DynamoDB call. The pure flag-type guards and hashing run for real.
 */

type Attrs = Record<string, unknown>;

// A single shared patch builder whose set/remove calls we can inspect.
const patchBuilder = {
  set: vi.fn((_attrs?: Attrs) => patchBuilder),
  remove: vi.fn((_names?: string[]) => patchBuilder),
  go: vi.fn(() => Promise.resolve({})),
};
const ctfPatch = vi.fn((_key?: Attrs) => patchBuilder);
const ctfCreate = vi.fn((_item?: Attrs) => ({ go: () => Promise.resolve({}) }));
// Default: the challenge already exists (edit path). Overridable per test.
const ctfGet = vi.fn<(key?: Attrs) => Promise<{ data: Attrs | null }>>(() =>
  Promise.resolve({ data: { challenge: "day1", enabled: true } }),
);

vi.mock("@/entities/qr", () => ({
  Qr: {},
  Qrstat: {},
  Ctf: {
    get: (key: Attrs) => ({ go: () => ctfGet(key) }),
    patch: (key: Attrs) => ctfPatch(key),
    create: (item: Attrs) => ctfCreate(item),
  },
}));

vi.mock("@/entities/ctf", () => ({
  CtfSolve: { query: { primary: () => ({ go: vi.fn().mockResolvedValue({ data: [] }) }) } },
  CtfScoreEvent: { query: { primary: () => ({ go: vi.fn().mockResolvedValue({ data: [] }) }) } },
}));

import { upsertCtf } from "../qr-admin";

const VALID_WINDOW = { days: [4, 5], from: "06:00", to: "08:00", tz: "UTC" };

describe("upsertCtf — CR-01 clear-the-window-on-disable", () => {
  beforeEach(() => {
    patchBuilder.set.mockClear();
    patchBuilder.remove.mockClear();
    patchBuilder.go.mockClear();
    ctfPatch.mockClear();
    ctfGet.mockResolvedValue({ data: { challenge: "day1", enabled: true } });
  });

  it("issues an attribute REMOVE for scoreWindow when the input is explicit null", async () => {
    await upsertCtf({ challenge: "day1", scoreWindow: null });
    expect(patchBuilder.remove).toHaveBeenCalledTimes(1);
    expect(patchBuilder.remove).toHaveBeenCalledWith(["scoreWindow"]);
    // The .set() payload must NOT carry a scoreWindow key (never .set(null)).
    const setArg = patchBuilder.set.mock.calls[0][0] as Record<string, unknown>;
    expect("scoreWindow" in setArg).toBe(false);
  });

  it("does NOT remove and DOES set the window when a real window is provided", async () => {
    await upsertCtf({ challenge: "day1", scoreWindow: VALID_WINDOW });
    expect(patchBuilder.remove).not.toHaveBeenCalled();
    const setArg = patchBuilder.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.scoreWindow).toEqual(VALID_WINDOW);
  });

  it("does NOT remove when scoreWindow is omitted (undefined ⇒ no-clobber preserves stored)", async () => {
    await upsertCtf({ challenge: "day1", pointMax: 500 });
    expect(patchBuilder.remove).not.toHaveBeenCalled();
    const setArg = patchBuilder.set.mock.calls[0][0] as Record<string, unknown>;
    expect("scoreWindow" in setArg).toBe(false);
  });

  it("on CREATE (no existing row) a null sentinel just omits the key — nothing to remove", async () => {
    ctfGet.mockResolvedValue({ data: null });
    await upsertCtf({ challenge: "brand-new", scoreWindow: null });
    expect(ctfCreate).toHaveBeenCalledTimes(1);
    const createArg = ctfCreate.mock.calls[0][0] as Record<string, unknown>;
    expect("scoreWindow" in createArg).toBe(false);
    expect(patchBuilder.remove).not.toHaveBeenCalled();
  });
});
