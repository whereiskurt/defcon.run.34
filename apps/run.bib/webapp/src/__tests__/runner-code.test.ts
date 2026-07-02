import { describe, it, expect, vi, beforeEach } from "vitest";

// runner-code.ts pulls in `@/entities/bib` (which itself constructs an
// ElectroDB Entity at module load and touches @aws-sdk/*). We only care
// about the collision-check behaviour of getBibByRunnerCode here, so mock
// the entities module with a controllable spy and short-circuit the whole
// AWS/ElectroDB import graph.
const mockGetBibByRunnerCode = vi.fn();

vi.mock("@/entities/bib", () => ({
  getBibByRunnerCode: (...args: unknown[]) =>
    mockGetBibByRunnerCode(...(args as [string])),
}));

// Import after the mock is registered.
import {
  RUNNER_CODE_ALPHABET,
  generateRunnerCode,
  generateUniqueRunnerCode,
} from "@/lib/runner-code";

describe("generateRunnerCode()", () => {
  beforeEach(() => {
    mockGetBibByRunnerCode.mockReset();
  });

  it("produces the BIB-XXXX shape (exactly 4 chars after the prefix)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRunnerCode();
      expect(code).toMatch(/^BIB-[A-Z2-9]{4}$/);
      expect(code.length).toBe(8); // "BIB-" (4) + 4 chars
    }
  });

  it("uses only the design-contract alphabet — no ambiguous 0/O/I/1", () => {
    // Generate a big batch so we exercise every alphabet slot with high
    // probability (32^4 space, 50k draws → ~65% of codes with any given char).
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) {
      const code = generateRunnerCode();
      for (const ch of code.slice(4)) {
        seen.add(ch);
      }
    }
    // Every drawn char must belong to the alphabet.
    for (const ch of seen) {
      expect(RUNNER_CODE_ALPHABET).toContain(ch);
    }
    // The design-contract regex [A-HJ-NP-Z2-9] drops 0, 1, I, O — those
    // must never appear either in the alphabet or in generated codes.
    // (L is intentionally kept — see the doc-string in runner-code.ts.)
    for (const ambiguous of ["0", "O", "I", "1"]) {
      expect(RUNNER_CODE_ALPHABET).not.toContain(ambiguous);
      expect(seen.has(ambiguous)).toBe(false);
    }
    // Alphabet is exactly 32 chars — validates the design-contract length.
    expect(RUNNER_CODE_ALPHABET.length).toBe(32);
  });
});

describe("generateUniqueRunnerCode()", () => {
  beforeEach(() => {
    mockGetBibByRunnerCode.mockReset();
  });

  it("returns immediately when the first candidate has no collision", async () => {
    mockGetBibByRunnerCode.mockResolvedValue(null);
    const code = await generateUniqueRunnerCode();
    expect(code).toMatch(/^BIB-[A-Z2-9]{4}$/);
    expect(mockGetBibByRunnerCode).toHaveBeenCalledTimes(1);
  });

  it("retries when the first candidate collides", async () => {
    // First attempt: existing bib returned → collision. Second attempt: null.
    mockGetBibByRunnerCode
      .mockResolvedValueOnce({ ownerSub: "existing", runnerCode: "BIB-AAAA" })
      .mockResolvedValueOnce(null);
    const code = await generateUniqueRunnerCode();
    expect(code).toMatch(/^BIB-[A-Z2-9]{4}$/);
    expect(mockGetBibByRunnerCode).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting maxAttempts when every candidate collides", async () => {
    // Every lookup returns an existing bib → collision → retry → collide → ...
    mockGetBibByRunnerCode.mockResolvedValue({
      ownerSub: "always-colliding",
      runnerCode: "BIB-XXXX",
    });
    await expect(generateUniqueRunnerCode(3)).rejects.toThrow(
      /Unable to generate a unique runnerCode after 3 attempts/
    );
    expect(mockGetBibByRunnerCode).toHaveBeenCalledTimes(3);
  });
});
