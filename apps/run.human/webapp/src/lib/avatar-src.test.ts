import { describe, it, expect } from "vitest";
import { resolveAvatarSrc } from "./avatar-src";

const BUNNY = "/bunny-head-alpha.png";

describe("resolveAvatarSrc", () => {
  it("keeps a real absolute avatar URL", () => {
    const url = "https://graph.discord.com/avatars/1/abc.png";
    expect(resolveAvatarSrc(url, BUNNY)).toBe(url);
  });

  it("falls back for Strava's relative no-photo sentinel", () => {
    // The exact string behind the reported /use1/avatar/athlete/medium.png 404.
    expect(resolveAvatarSrc("avatar/athlete/medium.png", BUNNY)).toBe(BUNNY);
  });

  it("falls back for the large/small Strava sentinel siblings", () => {
    expect(resolveAvatarSrc("avatar/athlete/large.png", BUNNY)).toBe(BUNNY);
    expect(resolveAvatarSrc("avatar/athlete/small.png", BUNNY)).toBe(BUNNY);
  });

  it("falls back for null and undefined", () => {
    expect(resolveAvatarSrc(null, BUNNY)).toBe(BUNNY);
    expect(resolveAvatarSrc(undefined, BUNNY)).toBe(BUNNY);
  });

  it("falls back for stringified nullish values from template literals", () => {
    expect(resolveAvatarSrc("undefined", BUNNY)).toBe(BUNNY);
    expect(resolveAvatarSrc("null", BUNNY)).toBe(BUNNY);
  });

  it("falls back for empty and whitespace-only values", () => {
    expect(resolveAvatarSrc("", BUNNY)).toBe(BUNNY);
    expect(resolveAvatarSrc("   ", BUNNY)).toBe(BUNNY);
  });

  it("falls back for any other relative path", () => {
    expect(resolveAvatarSrc("/images/me.png", BUNNY)).toBe(BUNNY);
    expect(resolveAvatarSrc("me.png", BUNNY)).toBe(BUNNY);
  });

  it("accepts http and mixed-case schemes", () => {
    expect(resolveAvatarSrc("http://example.com/a.png", BUNNY)).toBe(
      "http://example.com/a.png"
    );
    expect(resolveAvatarSrc("HTTPS://example.com/a.png", BUNNY)).toBe(
      "HTTPS://example.com/a.png"
    );
  });
});
