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
