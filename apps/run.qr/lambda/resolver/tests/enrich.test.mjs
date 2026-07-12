import { describe, it, expect } from "vitest";
import { enrichDestination } from "../lib/enrich.mjs";

describe("enrichDestination — passthrough", () => {
  it("returns an absolute URL unchanged when enrich is empty", () => {
    expect(
      enrichDestination("https://a.example/path", {
        originalQuery: "",
        param: null,
        enrich: {},
      })
    ).toBe("https://a.example/path");
  });

  it("returns a non-absolute destination unchanged (defensive)", () => {
    expect(
      enrichDestination("/relative/path", {
        originalQuery: "a=b",
        param: "x",
        enrich: { preserveQuery: true, appendParam: true },
      })
    ).toBe("/relative/path");
  });

  it("returns a plainly unparseable destination unchanged", () => {
    expect(
      enrichDestination("not a url", { enrich: { preserveQuery: true } })
    ).toBe("not a url");
  });
});

describe("enrichDestination — preserveQuery", () => {
  it("copies params from the original query into the destination", () => {
    const out = enrichDestination("https://a.example/", {
      originalQuery: "utm_source=poster&ref=42",
      enrich: { preserveQuery: true },
    });
    const u = new URL(out);
    expect(u.searchParams.get("utm_source")).toBe("poster");
    expect(u.searchParams.get("ref")).toBe("42");
  });

  it("does not copy anything when preserveQuery is falsy", () => {
    const out = enrichDestination("https://a.example/", {
      originalQuery: "utm_source=poster",
      enrich: {},
    });
    expect(new URL(out).searchParams.has("utm_source")).toBe(false);
  });

  it("dest's own params win on key collision (set only if absent)", () => {
    const out = enrichDestination("https://a.example/?ref=DEST", {
      originalQuery: "ref=ORIG&extra=1",
      enrich: { preserveQuery: true },
    });
    const u = new URL(out);
    expect(u.searchParams.get("ref")).toBe("DEST");
    expect(u.searchParams.get("extra")).toBe("1");
  });
});

describe("enrichDestination — appendParam", () => {
  it("sets 'p' to the param when appendParam is true and param is non-null", () => {
    const out = enrichDestination("https://a.example/", {
      param: "42",
      enrich: { appendParam: true },
    });
    expect(new URL(out).searchParams.get("p")).toBe("42");
  });

  it("does not set 'p' when param is null", () => {
    const out = enrichDestination("https://a.example/", {
      param: null,
      enrich: { appendParam: true },
    });
    expect(new URL(out).searchParams.has("p")).toBe(false);
  });

  it("does not set 'p' when appendParam is falsy", () => {
    const out = enrichDestination("https://a.example/", {
      param: "42",
      enrich: {},
    });
    expect(new URL(out).searchParams.has("p")).toBe(false);
  });
});

describe("enrichDestination — utm tags", () => {
  it("sets each defined utm subkey", () => {
    const out = enrichDestination("https://a.example/", {
      enrich: {
        utm: { source: "qr", medium: "sticker", campaign: "dc34" },
      },
    });
    const u = new URL(out);
    expect(u.searchParams.get("utm_source")).toBe("qr");
    expect(u.searchParams.get("utm_medium")).toBe("sticker");
    expect(u.searchParams.get("utm_campaign")).toBe("dc34");
  });

  it("only sets the utm subkeys that are defined", () => {
    const out = enrichDestination("https://a.example/", {
      enrich: { utm: { source: "qr" } },
    });
    const u = new URL(out);
    expect(u.searchParams.get("utm_source")).toBe("qr");
    expect(u.searchParams.has("utm_medium")).toBe(false);
    expect(u.searchParams.has("utm_campaign")).toBe(false);
  });
});

describe("enrichDestination — combined", () => {
  it("applies preserveQuery + appendParam + utm together", () => {
    const out = enrichDestination("https://a.example/go", {
      originalQuery: "ref=poster",
      param: "77",
      enrich: {
        preserveQuery: true,
        appendParam: true,
        utm: { source: "qr", campaign: "dc34" },
      },
    });
    const u = new URL(out);
    expect(u.searchParams.get("ref")).toBe("poster");
    expect(u.searchParams.get("p")).toBe("77");
    expect(u.searchParams.get("utm_source")).toBe("qr");
    expect(u.searchParams.get("utm_campaign")).toBe("dc34");
  });
});
