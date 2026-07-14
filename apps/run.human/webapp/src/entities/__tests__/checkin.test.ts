import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock electrodb's Entity before checkin.ts is imported,
// because it constructs the Entity at module-level.

const mockEntity = {
  model: { entity: "CheckIn", version: "1", service: "run" },
  create: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  query: {
    byUserRecent: vi.fn(),
    byGlobalRecent: vi.fn(),
  },
};

vi.mock("electrodb", () => {
  class MockEntity {
    model: any;
    create: any;
    get: any;
    delete: any;
    patch: any;
    query: any;
    constructor(schema: any) {
      this.model = schema.model;
      this.create = mockEntity.create;
      this.get = mockEntity.get;
      this.delete = mockEntity.delete;
      this.patch = mockEntity.patch;
      this.query = mockEntity.query;
      // Update the shared reference so tests can check model
      mockEntity.model = schema.model;
    }
  }
  return { Entity: MockEntity };
});

vi.mock("../client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro",
}));

const mockRunUserPatch = vi.fn();

vi.mock("../run-user", () => ({
  RunUser: {
    patch: (...args: any[]) => mockRunUserPatch(...args),
  },
}));

// The leaderboard check-in hook (Phase 49, LDBR-04) makes createCheckIn/
// deleteCheckIn also write/reverse an `activity` Accomplishment. This legacy
// suite isolates the check-in mechanics, so mock that side-effect at the module
// boundary — the accomplishment wiring itself is covered by checkin-hook.test.ts.
vi.mock("../accomplishment", () => ({
  createAccomplishment: vi.fn().mockResolvedValue(undefined),
  deleteAccomplishment: vi.fn().mockResolvedValue(undefined),
  accomplishmentIdFor: (source: string, externalId: string) =>
    `${source}#${externalId}`,
}));

// Mock crypto.randomUUID
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    default: {
      ...actual,
      randomUUID: () => "test-uuid-1234",
    },
  };
});

describe("CheckIn entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset RunUser.patch mock with chainable methods
    mockRunUserPatch.mockReturnValue({
      set: vi.fn().mockReturnValue({
        add: vi.fn().mockReturnValue({
          go: vi.fn().mockResolvedValue({}),
        }),
        go: vi.fn().mockResolvedValue({}),
      }),
      add: vi.fn().mockReturnValue({
        go: vi.fn().mockResolvedValue({}),
      }),
      subtract: vi.fn().mockReturnValue({
        go: vi.fn().mockResolvedValue({}),
      }),
    });
  });

  describe("GPSSample interface", () => {
    it("Test 1: GPSSample interface has all required fields", async () => {
      const { GPSSampleFields } = await import("../checkin");
      const expectedFields = [
        "latitude",
        "longitude",
        "accuracy",
        "altitude",
        "altitudeAccuracy",
        "heading",
        "speed",
        "timestamp",
      ];
      expect(GPSSampleFields).toEqual(expect.arrayContaining(expectedFields));
      expect(GPSSampleFields.length).toBe(expectedFields.length);
    });
  });

  describe("CheckIn entity model", () => {
    it("Test 2: CheckIn entity has correct service/entity/version", async () => {
      const { CheckIn } = await import("../checkin");
      expect(CheckIn).toBeDefined();
      expect(CheckIn.model).toBeDefined();
      expect(CheckIn.model.entity).toBe("CheckIn");
      expect(CheckIn.model.version).toBe("1");
      expect(CheckIn.model.service).toBe("run");
    });
  });

  describe("createCheckIn", () => {
    const sampleData = {
      source: "Web GPS",
      samples: [
        {
          latitude: 36.1699,
          longitude: -115.1398,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: 1000000,
        },
        {
          latitude: 36.1701,
          longitude: -115.14,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: 1030000,
        },
      ],
    };

    it("Test 3: computes average coordinates from samples correctly", async () => {
      const { createCheckIn } = await import("../checkin");

      let capturedData: any;
      mockEntity.create.mockImplementation((data: any) => {
        capturedData = data;
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      expect(capturedData.averageCoordinates.latitude).toBeCloseTo(
        (36.1699 + 36.1701) / 2,
        4
      );
      expect(capturedData.averageCoordinates.longitude).toBeCloseTo(
        (-115.1398 + -115.14) / 2,
        4
      );
    });

    it("Test 4: computes bestAccuracy as minimum accuracy from samples", async () => {
      const { createCheckIn } = await import("../checkin");

      let capturedData: any;
      mockEntity.create.mockImplementation((data: any) => {
        capturedData = data;
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      expect(capturedData.bestAccuracy).toBe(5);
    });

    it("Test 5: computes duration as time between first and last sample in seconds", async () => {
      const { createCheckIn } = await import("../checkin");

      let capturedData: any;
      mockEntity.create.mockImplementation((data: any) => {
        capturedData = data;
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      // (1030000 - 1000000) / 1000 = 30 seconds
      expect(capturedData.duration).toBe(30);
    });

    it("Test 6: calls RunUser.patch to increment checkInCount and set lastCheckInAt", async () => {
      const { createCheckIn } = await import("../checkin");

      mockEntity.create.mockImplementation((data: any) => {
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      expect(mockRunUserPatch).toHaveBeenCalledWith({ userId: "user-123" });
      // Verify chain: .set({ lastCheckInAt }).add({ checkInCount: 1 }).go()
      const setResult = mockRunUserPatch.mock.results[0].value.set;
      expect(setResult).toHaveBeenCalled();
      const addResult = setResult.mock.results[0].value.add;
      expect(addResult).toHaveBeenCalledWith({ checkInCount: 1 });
    });
  });

  describe("deleteCheckIn", () => {
    it("Test 7: calls RunUser.patch to decrement checkInCount", async () => {
      const { deleteCheckIn } = await import("../checkin");

      mockEntity.delete.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: {} }),
      });

      await deleteCheckIn("user-123", 1000000, "checkin-id-1");

      expect(mockRunUserPatch).toHaveBeenCalledWith({ userId: "user-123" });
      const subtractResult = mockRunUserPatch.mock.results[0].value.subtract;
      expect(subtractResult).toHaveBeenCalledWith({ checkInCount: 1 });
    });
  });

  describe("getCheckInsByUser", () => {
    it("Test 8: queries byUserRecent index with desc order and cursor pagination", async () => {
      const { getCheckInsByUser } = await import("../checkin");

      const mockGo = vi.fn().mockResolvedValue({
        data: [{ userId: "user-123" }],
        cursor: "next-cursor",
      });

      mockEntity.query.byUserRecent.mockReturnValue({
        go: mockGo,
      });

      const result = await getCheckInsByUser("user-123", 10, "prev-cursor");

      expect(mockEntity.query.byUserRecent).toHaveBeenCalledWith({
        userId: "user-123",
      });
      expect(mockGo).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          cursor: "prev-cursor",
          order: "desc",
        })
      );
      expect(result).toEqual({
        data: [{ userId: "user-123" }],
        cursor: "next-cursor",
      });
    });
  });

  describe("getRecentCheckIns", () => {
    it("Test 9: queries byGlobalRecent index with desc order and cursor pagination", async () => {
      const { getRecentCheckIns } = await import("../checkin");

      const mockGo = vi.fn().mockResolvedValue({
        data: [{ checkInId: "ci-1" }],
        cursor: "next-cursor",
      });

      mockEntity.query.byGlobalRecent.mockReturnValue({
        go: mockGo,
      });

      const result = await getRecentCheckIns(5, "prev-cursor");

      expect(mockEntity.query.byGlobalRecent).toHaveBeenCalledWith({});
      expect(mockGo).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 5,
          cursor: "prev-cursor",
          order: "desc",
        })
      );
      expect(result).toEqual({
        data: [{ checkInId: "ci-1" }],
        cursor: "next-cursor",
      });
    });
  });

  describe("updateCheckInPrivacy", () => {
    it("Test 10: updates isPrivate field on existing check-in", async () => {
      const { updateCheckInPrivacy } = await import("../checkin");

      const mockSet = vi.fn().mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: {} }),
      });

      mockEntity.patch.mockReturnValue({
        set: mockSet,
      });

      await updateCheckInPrivacy("user-123", 1000000, "checkin-id-1", false);

      expect(mockEntity.patch).toHaveBeenCalledWith({
        userId: "user-123",
        timestamp: 1000000,
        checkInId: "checkin-id-1",
      });
      expect(mockSet).toHaveBeenCalledWith({ isPrivate: false });
    });
  });
});
