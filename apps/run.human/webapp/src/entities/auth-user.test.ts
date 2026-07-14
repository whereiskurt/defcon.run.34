import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LDBR-06: the shared sub -> adapter-userId resolver (getAdapterUserIdBySub).
 *
 * Proves the GSI1 account bridge WITHOUT a live table: mocks
 * `@/entities/client` so `dynamodbClient.query` returns a controlled result and
 * asserts (1) the resolved id, (2) the null path when no account maps, and
 * (3) the exact GSI1 key values the query is issued with (GSI1PK =
 * ACCOUNT#run.defcon.run, GSI1SK = ACCOUNT#{sub}).
 */

const mockQuery = vi.fn();

vi.mock("@/entities/client", () => ({
  dynamodbClient: { query: (...a: unknown[]) => mockQuery(...a) },
  DYNAMODB_TABLE: "test-table",
}));

import { getAdapterUserIdBySub } from "./auth-user";

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getAdapterUserIdBySub", () => {
  it("resolves Items[0].userId to the adapter userId", async () => {
    mockQuery.mockResolvedValue({ Items: [{ userId: "uuid-1" }] });
    expect(await getAdapterUserIdBySub("sub-x")).toBe("uuid-1");
  });

  it("resolves null when no account maps (empty Items)", async () => {
    mockQuery.mockResolvedValue({ Items: [] });
    expect(await getAdapterUserIdBySub("sub-missing")).toBeNull();
  });

  it("resolves null when Items is absent", async () => {
    mockQuery.mockResolvedValue({});
    expect(await getAdapterUserIdBySub("sub-none")).toBeNull();
  });

  it("keys GSI1 with ACCOUNT#run.defcon.run / ACCOUNT#{sub}", async () => {
    mockQuery.mockResolvedValue({ Items: [{ userId: "uuid-2" }] });
    await getAdapterUserIdBySub("sub-y");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const arg = mockQuery.mock.calls[0][0] as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(arg.IndexName).toBe("GSI1");
    expect(arg.ExpressionAttributeValues[":gsi1pk"]).toBe(
      "ACCOUNT#run.defcon.run"
    );
    expect(arg.ExpressionAttributeValues[":gsi1sk"]).toBe("ACCOUNT#sub-y");
  });
});
