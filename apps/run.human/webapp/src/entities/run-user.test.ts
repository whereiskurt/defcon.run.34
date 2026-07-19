import { describe, it, expect } from "vitest";
import { activityDelta } from "./run-user";

// The former embedded-radio-sanitizer unit tests were removed in Phase 66
// (MRAD-04, LOCKED hard-switch): the embedded RunUser radios list, its item
// type, and its read-back sanitizer are retired (now the first-class MeshRadio
// entity). MeshRadio's typed attributes replace the empty-string→NULL read-back
// concern the sanitizer guarded, so there is nothing left to sanitize here.
//
// A minimal pure-helper test is kept so this file still exercises a RunUser
// export and does not become an empty suite.

describe("activityDelta", () => {
  it("increments score and count on create", () => {
    const d = activityDelta("checkin", 3, true);
    expect(d).toEqual({ scoreDelta: 3, countKey: "checkin", countDelta: 1 });
  });
  it("negates score and count on delete", () => {
    const d = activityDelta("gpx", 5, false);
    expect(d).toEqual({ scoreDelta: -5, countKey: "gpx", countDelta: -1 });
  });
});
