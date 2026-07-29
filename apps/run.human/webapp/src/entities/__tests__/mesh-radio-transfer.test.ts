import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Ownership-transfer invariants for transferMeshRadioOwner.
 *
 * These are the tests that would have caught the authorization hole: the internal
 * register boundary used to blind-patch an existing row's keys, so a re-flash by a
 * DIFFERENT account overwrote the owner's key material and flipped `verified` while
 * `userId` -- and therefore the byUser GSI -- stayed with the original owner.
 *
 * The AWS document client is stubbed so the REAL ElectroDB key composition runs:
 * these assertions are about the actual DynamoDB UpdateItem the entity emits, not
 * about a mock of it. `byUser` is what "my radios" queries, so proving the emitted
 * gsi1pk lands in the new owner's partition (and leaves the old one) is the whole
 * point -- a userId-only write would leave that index lying.
 */

const sent: Array<{ name: string; input: Record<string, unknown> }> = [];

/** The row as it exists BEFORE the transfer, returned by the post-patch re-read. */
let storedItem: Record<string, unknown> = {};

vi.mock("../client", () => ({
  ELECTRO_TABLE: "run-human-electro",
  electroClient: {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetCommand") return { Item: storedItem };
      return {};
    }),
  },
}));

import { MeshRadio, transferMeshRadioOwner } from "../mesh-radio";

const OLD_OWNER = "473d02cd-old-owner";
const NEW_OWNER = "041287e3-new-owner";
const NODE_ID = "!4359d0cc";

/** The pre-transfer row, mirroring the real incident's shape. */
function existingRow() {
  return {
    nodeId: NODE_ID,
    nodeNum: 1130409164,
    userId: OLD_OWNER,
    publicKey: "0x" + "a".repeat(64),
    privateKey: "OLD_OWNER_PRIVATE",
    verified: true,
    verifiedAt: 1_000,
    verificationCode: "314633",
    codeSentAt: 900,
    verificationAttempts: 2,
    resendAttempts: 1,
    impersonate: true,
    showOnMap: true,
    source: "flash" as const,
    createdAt: 500,
  };
}

/** The single UpdateItem the transfer emits. */
function updateInput() {
  const update = sent.find((c) => c.name === "UpdateCommand");
  if (!update) throw new Error(`no UpdateCommand emitted; got ${sent.map((s) => s.name).join()}`);
  return update.input as {
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
    ConditionExpression?: string;
    Key: Record<string, string>;
  };
}

/** The gsi1pk partition MeshRadio.query.byUser() reads for a given user. */
function byUserPartition(userId: string) {
  const params = MeshRadio.query.byUser({ userId }).params({
    table: "run-human-electro",
  }) as { ExpressionAttributeValues: Record<string, string> };
  return params.ExpressionAttributeValues[":pk"];
}

beforeEach(() => {
  sent.length = 0;
  storedItem = existingRow();
});

describe("transferMeshRadioOwner", () => {
  it("moves the byUser GSI partition to the new owner and off the old one", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);

    const values = updateInput().ExpressionAttributeValues;
    // The emitted gsi1pk is the partition the NEW owner's "my radios" query reads.
    expect(values[":gsi1pk_u0"]).toBe(byUserPartition(NEW_OWNER));
    // ...and is NOT the old owner's partition, so their listing loses the row.
    expect(values[":gsi1pk_u0"]).not.toBe(byUserPartition(OLD_OWNER));
    // Guard the regression directly: userId must actually move.
    expect(values[":userId_u0"]).toBe(NEW_OWNER);
    // A userId-only write that left the index stale is exactly the bug.
    expect(updateInput().UpdateExpression).toMatch(/#gsi1pk = :gsi1pk_u0/);
  });

  it("writes the previousUserId / transferredAt audit trail", async () => {
    const before = Date.now();
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    const values = updateInput().ExpressionAttributeValues;

    expect(values[":previousUserId_u0"]).toBe(OLD_OWNER);
    expect(values[":transferredAt_u0"]).toBeGreaterThanOrEqual(before);
  });

  it("re-stamps verifiedAt so it stops pointing at the previous owner's verification", async () => {
    const before = Date.now();
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    const values = updateInput().ExpressionAttributeValues;

    expect(values[":verified_u0"]).toBe(true);
    expect(values[":verifiedAt_u0"]).toBeGreaterThanOrEqual(before);
    // The stale 1_000 belonged to OLD_OWNER's verification event.
    expect(values[":verifiedAt_u0"]).not.toBe(1_000);
  });

  it("drops the previous owner's verification secrets", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    expect(updateInput().UpdateExpression).toMatch(
      /REMOVE #verificationCode, #codeSentAt/
    );
  });

  it("stores the new owner's device keys when supplied", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER, {
      publicKey: "0x" + "b".repeat(64),
      privateKey: "NEW_OWNER_PRIVATE",
    });
    const values = updateInput().ExpressionAttributeValues;

    expect(values[":publicKey_u0"]).toBe("0x" + "b".repeat(64));
    expect(values[":privateKey_u0"]).toBe("NEW_OWNER_PRIVATE");
  });

  it("is a partial update: never rewrites createdAt / source / showOnMap / impersonate / nodeNum", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    const expr = updateInput().UpdateExpression;

    // A full-item `put` would have to re-supply these and would silently drop any
    // it forgot (and reset the readOnly createdAt default). `patch` cannot.
    for (const field of ["createdAt", "source", "showOnMap", "impersonate", "nodeNum"]) {
      expect(expr).not.toMatch(new RegExp(`#${field} =`));
    }
    // Counters ride along untouched for the same reason.
    for (const field of ["verificationAttempts", "resendAttempts"]) {
      expect(expr).not.toMatch(new RegExp(`#${field} =`));
    }
  });

  it("cannot create a row -- a transfer only ever mutates an existing radio", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    expect(updateInput().ConditionExpression).toMatch(/attribute_exists\(#pk\)/);
  });

  it("keeps the parity-locked primary key put (meshtk's GetItem hot path) fixed", async () => {
    await transferMeshRadioOwner(existingRow(), NEW_OWNER);
    // Ownership moves; the nodeId-keyed row meshtk decrypts against must not.
    expect(updateInput().Key).toEqual({
      pk: "$run#nodeid_!4359d0cc",
      sk: "$meshradio_1",
    });
  });
});
