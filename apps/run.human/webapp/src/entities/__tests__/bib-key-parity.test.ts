import { describe, it, expect } from "vitest";
import { Entity } from "electrodb";
import { Bib as MirrorBib } from "../bib";

/**
 * The profile page reads the bib's runnerCode via a minimal, read-only mirror
 * of the Bib entity (src/entities/bib.ts). The bib SERVICE (run.bib) owns the
 * real entity and does the writes. If the two compose even slightly different
 * DynamoDB keys, our read silently returns null forever.
 *
 * This locks that risk down: build the bib service's FULL Bib config verbatim
 * (copied from apps/run.bib/webapp/src/entities/bib.ts) and assert our mirror
 * generates an identical primary Key for the same ownerSub.
 */
const FullBib = new Entity({
  model: { entity: "Bib", version: "1", service: "run" },
  attributes: {
    ownerSub: { type: "string", required: true },
    nameOnBib: { type: "string", default: "" },
    runnerCode: { type: "string", required: true, readOnly: true },
    paidAmount: { type: "number", default: 0 },
    paidStatusHistory: {
      type: "list",
      items: {
        type: "map",
        properties: {
          provider: { type: "string" },
          amount: { type: "number" },
          timestamp: { type: "string" },
          reconciled_via: { type: "string" },
        },
      },
      default: () => [],
    },
    nameLocked: { type: "boolean", default: false },
    willPayInPerson: { type: "boolean", default: false },
    burned: { type: "boolean", default: false },
    createdAt: { type: "string", default: () => "", readOnly: true },
    updatedAt: { type: "string", default: () => "", watch: "*", set: () => "" },
  },
  indexes: {
    primary: {
      pk: { field: "pk", composite: ["ownerSub"] },
      sk: { field: "sk", composite: [], template: "BIB" },
    },
    byRunnerCode: {
      index: "runnerCode-index",
      pk: { field: "runnerCode", composite: ["runnerCode"] },
    },
  },
} as const);

describe("Bib mirror key parity", () => {
  it("composes the same primary Key as the bib service's full entity", () => {
    const ownerSub = "auth0|abc123DEF456";
    const table = "run-human-electro";
    const mine = MirrorBib.get({ ownerSub }).params({ table });
    const theirs = FullBib.get({ ownerSub }).params({ table });
    expect(mine.Key).toEqual(theirs.Key);
  });

  it("produces a stable, non-empty pk/sk", () => {
    const mine = MirrorBib.get({ ownerSub: "x" }).params({ table: "t" });
    expect(mine.Key.pk).toBeTruthy();
    expect(mine.Key.sk).toBeTruthy();
  });
});
