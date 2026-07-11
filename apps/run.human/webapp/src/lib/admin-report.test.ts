import { describe, it, expect } from "vitest";
import {
  maskEmail,
  csvCell,
  toCsv,
  sortRows,
  filterByEmail,
  lastActivityOf,
  runnerQrUrl,
  type UserReportRow,
} from "./admin-report";

/**
 * Unit tests for the PII-sensitive pure helpers behind the Phase 43 admin users
 * report (ADMN-03/04/07). These prove the security-critical invariants the route
 * relies on WITHOUT mocking the DynamoDB scans:
 *   - maskEmail never leaks more than the first local-part char,
 *   - csvCell/toCsv escape RFC-4180 specials (" , \n),
 *   - sortRows orders DESC by each key,
 *   - lastActivityAt = max(updatedAt, lastLoginAt, lastCheckInAt).
 */

function row(over: Partial<UserReportRow>): UserReportRow {
  return {
    displayName: "",
    userId: "u",
    emailFull: null,
    emailMasked: "",
    bibCode: null,
    qrUrl: "",
    signedUpAt: null,
    lastLoginAt: null,
    lastActivityAt: null,
    checkInCount: 0,
    gpxRoutes: 0,
    gpxSaves: 0,
    gpxShares: 0,
    uploads: 0,
    services: [],
    ...over,
  };
}

describe("maskEmail", () => {
  it("keeps first local char + full domain, never more of the local-part", () => {
    const masked = maskEmail("kurt@gmail.com");
    expect(masked).toBe("k•••@gmail.com");
    expect(masked).not.toContain("urt");
    expect(masked.endsWith("@gmail.com")).toBe(true);
  });

  it("never leaks the local-part for a long address", () => {
    const masked = maskEmail("alexandra.longname@example.org");
    // Only the first char of the local part may survive.
    expect(masked).toBe("a•••@example.org");
    expect(masked).not.toContain("lexandra");
    expect(masked).not.toContain("longname");
  });

  it("masks a single-char local part", () => {
    expect(maskEmail("x@d.co")).toBe("x•••@d.co");
  });

  it("returns empty string for null/empty", () => {
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("")).toBe("");
  });

  it("does not echo a malformed value (no @ / leading @)", () => {
    expect(maskEmail("notanemail")).toBe("•••");
    expect(maskEmail("@nope.com")).toBe("•••");
  });
});

describe("csvCell / toCsv (RFC-4180)", () => {
  it("quotes and doubles quotes in a cell", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it("quotes cells containing comma or newline", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("leaves plain values unquoted and blanks null/undefined", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("serializes a header row + escaped body rows", () => {
    const csv = toCsv(
      [
        { key: "name", header: "Name" },
        { key: "note", header: "Note" },
      ],
      [
        { name: "kurt", note: 'has "quotes", and, commas' },
        { name: "multi", note: "line1\nline2" },
      ]
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Name,Note");
    expect(lines[1]).toBe('kurt,"has ""quotes"", and, commas"');
    // The newline inside the last cell is preserved within the quoted field.
    expect(csv).toContain('"line1\nline2"');
  });
});

describe("lastActivityOf", () => {
  it("returns the max of the three timestamps", () => {
    expect(
      lastActivityOf({ updatedAt: 100, lastLoginAt: 300, lastCheckInAt: 200 })
    ).toBe(300);
    expect(
      lastActivityOf({ updatedAt: 900, lastLoginAt: 300, lastCheckInAt: 200 })
    ).toBe(900);
  });

  it("ignores missing fields and returns null when none present", () => {
    expect(lastActivityOf({ lastCheckInAt: 500 })).toBe(500);
    expect(lastActivityOf({})).toBeNull();
  });
});

describe("sortRows", () => {
  it("sorts by lastActivity desc", () => {
    const rows = [
      row({ userId: "a", lastActivityAt: 100 }),
      row({ userId: "b", lastActivityAt: 900 }),
      row({ userId: "c", lastActivityAt: 300 }),
    ];
    expect(sortRows(rows, "lastActivity").map((r) => r.userId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by gpxUsage desc (routes+saves+shares)", () => {
    const rows = [
      row({ userId: "a", gpxRoutes: 1, gpxSaves: 1, gpxShares: 0 }), // 2
      row({ userId: "b", gpxRoutes: 5, gpxSaves: 5, gpxShares: 5 }), // 15
      row({ userId: "c", gpxRoutes: 0, gpxSaves: 3, gpxShares: 0 }), // 3
    ];
    expect(sortRows(rows, "gpxUsage").map((r) => r.userId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by signup desc and does not mutate the input", () => {
    const rows = [
      row({ userId: "a", signedUpAt: 10 }),
      row({ userId: "b", signedUpAt: 30 }),
      row({ userId: "c", signedUpAt: 20 }),
    ];
    const sorted = sortRows(rows, "signup");
    expect(sorted.map((r) => r.userId)).toEqual(["b", "c", "a"]);
    // original order preserved (non-mutating)
    expect(rows.map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });
});

describe("filterByEmail", () => {
  it("filters by full-email substring, case-insensitive", () => {
    const rows = [
      row({ userId: "a", emailFull: "kurt@gmail.com" }),
      row({ userId: "b", emailFull: "jane@example.org" }),
      row({ userId: "c", emailFull: null }),
    ];
    expect(filterByEmail(rows, "GMAIL").map((r) => r.userId)).toEqual(["a"]);
    expect(filterByEmail(rows, "example").map((r) => r.userId)).toEqual(["b"]);
    expect(filterByEmail(rows, "").map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });
});

describe("runnerQrUrl", () => {
  it("builds the run-user.ts QR template with env defaults", () => {
    const prevDomain = process.env.SITE_DOMAIN;
    const prevRegion = process.env.REGION_SHORT;
    delete process.env.SITE_DOMAIN;
    delete process.env.REGION_SHORT;
    try {
      expect(runnerQrUrl("abc")).toBe("https://run.defcon.run/use1/r?h=abc");
    } finally {
      if (prevDomain !== undefined) process.env.SITE_DOMAIN = prevDomain;
      if (prevRegion !== undefined) process.env.REGION_SHORT = prevRegion;
    }
  });
});
