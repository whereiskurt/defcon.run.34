import { describe, it, expect } from "vitest";

import {
  AWARD_PROP,
  SIZE_TOLERANCE,
  buildDecoySheet,
  buildWinSheet,
} from "../ctf-covert-css";

const POINTS = [1, 42, 734, 99999];

describe("ctf-covert-css", () => {
  it("AWARD_PROP reads as an innocuous theme-token custom property", () => {
    expect(AWARD_PROP).toBe("--accent-ramp");
    expect(AWARD_PROP).toMatch(/^--[a-z-]+$/);
  });

  it("win sheet assigns AWARD_PROP the numeric points", () => {
    expect(buildWinSheet(734)).toContain(`${AWARD_PROP}: 734`);
    expect(buildWinSheet(1)).toContain(`${AWARD_PROP}: 1`);
  });

  it("decoy sheet never contains AWARD_PROP (presence-only marker)", () => {
    expect(buildDecoySheet()).not.toContain(AWARD_PROP);
  });

  it("decoy and win bodies are byte-plausible within SIZE_TOLERANCE (T-46-02)", () => {
    const decoy = buildDecoySheet().length;
    for (const p of POINTS) {
      expect(Math.abs(decoy - buildWinSheet(p).length)).toBeLessThanOrEqual(
        SIZE_TOLERANCE,
      );
    }
  });

  it("neither sheet leaks the raw guess/flag or any win/auth/ctf word", () => {
    const bodies = [buildDecoySheet(), ...POINTS.map(buildWinSheet)];
    for (const body of bodies) {
      expect(body).not.toMatch(/win|award|flag|auth|ctf|solve|point|secret/i);
    }
  });

  it("both sheets look like a plain theme stylesheet (:root vars)", () => {
    expect(buildDecoySheet()).toContain(":root");
    expect(buildWinSheet(42)).toContain(":root");
  });
});
