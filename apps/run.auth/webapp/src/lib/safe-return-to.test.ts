import { describe, it, expect } from "vitest";
import { safeReturnTo } from "./safe-return-to";

const BASE = "https://auth.defcon.run";

describe("safeReturnTo", () => {
  it("allows a defcon.run subdomain — the gpx studio Add Run screen", () => {
    expect(
      safeReturnTo("https://gpx.defcon.run/use1/studio/app?addrun", BASE)
    ).toBe("https://gpx.defcon.run/use1/studio/app?addrun");
  });

  it("allows the apex domain", () => {
    expect(safeReturnTo("https://defcon.run/whoami", BASE)).toBe(
      "https://defcon.run/whoami"
    );
  });

  it("allows a same-origin relative path", () => {
    expect(safeReturnTo("/use1/profile", BASE)).toBe(
      "https://auth.defcon.run/use1/profile"
    );
  });

  it("falls back to / when absent", () => {
    expect(safeReturnTo(null, BASE)).toBe("/");
    expect(safeReturnTo(undefined, BASE)).toBe("/");
    expect(safeReturnTo("", BASE)).toBe("/");
  });

  it("rejects an unrelated host", () => {
    expect(safeReturnTo("https://evil.example.com/steal", BASE)).toBe("/");
  });

  it("rejects a lookalike that merely ENDS WITH defcon.run", () => {
    // The bug a naive endsWith("defcon.run") check would ship.
    expect(safeReturnTo("https://evildefcon.run/steal", BASE)).toBe("/");
    expect(safeReturnTo("https://notdefcon.run/", BASE)).toBe("/");
  });

  it("rejects a host that only contains defcon.run as a prefix", () => {
    expect(safeReturnTo("https://defcon.run.evil.com/", BASE)).toBe("/");
  });

  it("rejects javascript: and data: targets", () => {
    expect(safeReturnTo("javascript:alert(1)", BASE)).toBe("/");
    expect(safeReturnTo("data:text/html,<script>alert(1)</script>", BASE)).toBe(
      "/"
    );
  });

  it("rejects a protocol-relative URL pointing off-site", () => {
    expect(safeReturnTo("//evil.example.com/steal", BASE)).toBe("/");
  });

  it("rejects localhost unless explicitly allowed", () => {
    expect(safeReturnTo("http://localhost:3003/studio/app", BASE)).toBe("/");
    expect(
      safeReturnTo("http://localhost:3003/studio/app", BASE, {
        allowLocalhost: true,
      })
    ).toBe("http://localhost:3003/studio/app");
  });

  it("is case-insensitive about the host", () => {
    expect(safeReturnTo("https://GPX.DefCon.Run/use1/studio/app", BASE)).toBe(
      "https://gpx.defcon.run/use1/studio/app"
    );
  });

  it("rejects garbage that isn't a URL at all", () => {
    expect(safeReturnTo("http://[bad", BASE)).toBe("/");
  });
});
