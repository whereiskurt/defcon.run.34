import { describe, it, expect } from "vitest";
import { parsePath } from "../lib/parse-path.mjs";

describe("parsePath — query splitting", () => {
  it("returns empty query when there is no '?'", () => {
    expect(parsePath("/BUNNY").query).toBe("");
  });

  it("captures everything after the first '?' as query (no leading '?')", () => {
    const r = parsePath("/BUNNY/42?utm_source=x&a=b");
    expect(r.query).toBe("utm_source=x&a=b");
  });

  it("keeps later '?' characters inside the query verbatim", () => {
    expect(parsePath("/X?a=b?c=d").query).toBe("a=b?c=d");
  });

  it("treats a trailing '?' with no query as empty query", () => {
    expect(parsePath("/X?").query).toBe("");
  });
});

describe("parsePath — empty", () => {
  it("classifies '/' as empty", () => {
    expect(parsePath("/")).toEqual({ kind: "empty", query: "" });
  });

  it("classifies the empty string as empty", () => {
    expect(parsePath("")).toEqual({ kind: "empty", query: "" });
  });

  it("classifies a path of only slashes as empty and preserves query", () => {
    expect(parsePath("///?z=1")).toEqual({ kind: "empty", query: "z=1" });
  });
});

describe("parsePath — flush (reserved)", () => {
  it("classifies a leading _flush segment as flush", () => {
    expect(parsePath("/_flush")).toEqual({ kind: "flush", query: "" });
  });

  it("classifies _flush as flush even with trailing segments and query", () => {
    expect(parsePath("/_flush/anything?t=tok")).toEqual({
      kind: "flush",
      query: "t=tok",
    });
  });

  it("never returns _flush as a redirect code", () => {
    expect(parsePath("/_flush").kind).not.toBe("redirect");
  });
});

describe("parsePath — ogimage (reserved)", () => {
  it("classifies /_og/<theme>.png as ogimage with the theme (suffix stripped)", () => {
    expect(parsePath("/_og/cherries.png")).toEqual({
      kind: "ogimage",
      theme: "cherries",
      query: "",
    });
  });

  it("lowercases the theme and strips only a trailing .png", () => {
    expect(parsePath("/_og/CHERRIES.PNG").theme).toBe("cherries");
  });

  it("degrades to a blank theme when none is given (resolver 404s it)", () => {
    expect(parsePath("/_og")).toEqual({ kind: "ogimage", theme: "", query: "" });
  });

  it("never returns _og as a redirect code", () => {
    expect(parsePath("/_og/cherries.png").kind).not.toBe("redirect");
  });
});

describe("parsePath — ctf (reserved)", () => {
  it("parses challenge and single-segment value", () => {
    expect(parsePath("/ctf/crypto/abc123")).toEqual({
      kind: "ctf",
      challenge: "crypto",
      value: "abc123",
      query: "",
    });
  });

  it("joins remaining segments after the challenge as value (verbatim)", () => {
    expect(parsePath("/ctf/maze/a/b/c")).toEqual({
      kind: "ctf",
      challenge: "maze",
      value: "a/b/c",
      query: "",
    });
  });

  it("returns empty value when only a challenge is present", () => {
    expect(parsePath("/ctf/onlychallenge")).toEqual({
      kind: "ctf",
      challenge: "onlychallenge",
      value: "",
      query: "",
    });
  });

  it("preserves query on a ctf submission", () => {
    expect(parsePath("/ctf/crypto/flag?debug=1").query).toBe("debug=1");
  });

  it("degrades to empty when ctf has no challenge segment", () => {
    expect(parsePath("/ctf")).toEqual({ kind: "empty", query: "" });
  });

  it("does NOT uppercase the challenge (case-sensitive)", () => {
    expect(parsePath("/ctf/MiXeD/v").challenge).toBe("MiXeD");
  });

  it("never returns ctf as a redirect code", () => {
    expect(parsePath("/ctf/x/y").kind).not.toBe("redirect");
  });
});

describe("parsePath — award (reserved)", () => {
  it("classifies /a/<nonce> as award, carrying the nonce verbatim", () => {
    expect(parsePath("/a/k7m3q9x2wr4t")).toEqual({
      kind: "award",
      nonce: "k7m3q9x2wr4t",
      query: "",
    });
  });

  it("does NOT uppercase the nonce (case-kept, unlike a redirect code)", () => {
    expect(parsePath("/a/AbC").nonce).toBe("AbC");
  });

  it("degrades to empty when the award letter carries no nonce", () => {
    expect(parsePath("/a")).toEqual({ kind: "empty", query: "" });
    expect(parsePath("/a/")).toEqual({ kind: "empty", query: "" });
  });

  it("preserves query on an award claim", () => {
    expect(parsePath("/a/xyz?utm=1")).toEqual({
      kind: "award",
      nonce: "xyz",
      query: "utm=1",
    });
  });

  it("ignores segments beyond the nonce", () => {
    expect(parsePath("/a/xyz/extra").nonce).toBe("xyz");
  });

  it("never returns the award namespace as a redirect code", () => {
    expect(parsePath("/a/k7m3q9x2wr4t").kind).not.toBe("redirect");
  });

  it("reserves ONLY the lowercase letter — /A/<x> stays a redirect for code A", () => {
    expect(parsePath("/A/xyz")).toEqual({
      kind: "redirect",
      code: "A",
      param: "xyz",
      query: "",
    });
  });
});

describe("parsePath — live single-letter short codes (regression guard)", () => {
  // b c d f g h p r are LIVE codes on q.defcon.run (e.g. /c → didhtp1).
  // Reserving a new single-letter namespace must never reclassify one of them —
  // this assertion is exactly what caught the original `/c/` collision.
  const LIVE_SINGLE_LETTER_CODES = ["b", "c", "d", "f", "g", "h", "p", "r"];

  it.each(LIVE_SINGLE_LETTER_CODES)(
    "still classifies /%s as a redirect",
    (letter) => {
      expect(parsePath(`/${letter}`)).toEqual({
        kind: "redirect",
        code: letter.toUpperCase(),
        param: null,
        query: "",
      });
    }
  );

  it.each(LIVE_SINGLE_LETTER_CODES)(
    "still classifies /%s/<param> as a redirect with the param intact",
    (letter) => {
      expect(parsePath(`/${letter}/42?v=1`)).toEqual({
        kind: "redirect",
        code: letter.toUpperCase(),
        param: "42",
        query: "v=1",
      });
    }
  );
});

describe("parsePath — redirect", () => {
  it("uppercases the first segment as the code", () => {
    expect(parsePath("/bunny")).toEqual({
      kind: "redirect",
      code: "BUNNY",
      param: null,
      query: "",
    });
  });

  it("takes the 2nd segment verbatim as param", () => {
    expect(parsePath("/Bunny/42")).toEqual({
      kind: "redirect",
      code: "BUNNY",
      param: "42",
      query: "",
    });
  });

  it("ignores segments beyond the second", () => {
    expect(parsePath("/x/y/z/w")).toEqual({
      kind: "redirect",
      code: "X",
      param: "y",
      query: "",
    });
  });

  it("keeps param case-sensitive", () => {
    expect(parsePath("/CODE/AbC").param).toBe("AbC");
  });

  it("carries query onto a redirect", () => {
    expect(parsePath("/CODE/p?k=v").query).toBe("k=v");
  });
});
