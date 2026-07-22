import { describe, it, expect } from "vitest";
import { findDuplicateAuthCookies } from "./legacy-cookie-cleanup";

describe("findDuplicateAuthCookies", () => {
  it("returns nothing for a missing header", () => {
    expect(findDuplicateAuthCookies(null)).toEqual([]);
    expect(findDuplicateAuthCookies(undefined)).toEqual([]);
    expect(findDuplicateAuthCookies("")).toEqual([]);
  });

  it("returns nothing when each auth cookie appears once", () => {
    expect(
      findDuplicateAuthCookies("sess_run=abc; csrf_run=def; state_run=ghi")
    ).toEqual([]);
  });

  it("flags an auth cookie name that appears twice (legacy + host-only)", () => {
    expect(
      findDuplicateAuthCookies("sess_run=legacy; csrf_run=x; sess_run=new")
    ).toEqual(["sess_run"]);
  });

  it("flags chunked session cookie duplicates independently", () => {
    expect(
      findDuplicateAuthCookies(
        "sess_run.0=a; sess_run.1=b; sess_run.0=c; sess_run=d"
      )
    ).toEqual(["sess_run.0"]);
  });

  it("ignores duplicates of non-auth cookies and similar prefixes", () => {
    expect(
      findDuplicateAuthCookies(
        "theme=dark; theme=light; sess_runner=x; sess_runner=y; sess_run=only"
      )
    ).toEqual([]);
  });

  it("handles whitespace and multiple duplicated names", () => {
    expect(
      findDuplicateAuthCookies(
        " sess_run=a ;  state_run=b;sess_run=c; state_run=d "
      ).sort()
    ).toEqual(["sess_run", "state_run"]);
  });
});
