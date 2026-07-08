import { describe, it, expect } from "vitest";
import { parseStatus } from "@/lib/order-status";

/**
 * ③ (2026-07-08) — the general-donation success_url lands on
 * `/orderform?status=donated` so a donation return can be told apart from a bib
 * purchase (`status=success`). parseStatus narrows the querystring.
 */
describe("parseStatus", () => {
  it("recognizes the three known states", () => {
    expect(parseStatus("success")).toBe("success");
    expect(parseStatus("cancel")).toBe("cancel");
    expect(parseStatus("donated")).toBe("donated");
  });

  it("rejects anything else", () => {
    expect(parseStatus("bogus")).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
    expect(parseStatus(["success", "donated"])).toBeNull();
  });
});
