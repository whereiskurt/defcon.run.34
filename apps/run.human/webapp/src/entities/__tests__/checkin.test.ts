import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module
vi.mock("../client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro",
}));

// Mock the run-user module
vi.mock("../run-user", () => ({
  RunUser: {
    patch: vi.fn().mockReturnValue({
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
    }),
  },
}));

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: () => "test-uuid-1234",
});

describe("CheckIn entity", () => {
  describe("GPSSample interface", () => {
    it("Test 1: GPSSample interface has all required fields", async () => {
      const { GPSSampleFields } = await import("../checkin");
      // GPSSampleFields is a runtime array listing all fields of the GPSSample interface
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
      // ElectroDB entities expose their model
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

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("Test 3: computes average coordinates from samples correctly", async () => {
      const { createCheckIn, CheckIn } = await import("../checkin");

      // Mock CheckIn.create to capture what was passed
      let capturedData: any;
      CheckIn.create = vi.fn().mockImplementation((data: any) => {
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
      const { createCheckIn, CheckIn } = await import("../checkin");

      let capturedData: any;
      CheckIn.create = vi.fn().mockImplementation((data: any) => {
        capturedData = data;
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      expect(capturedData.bestAccuracy).toBe(5); // Math.min(10, 5)
    });

    it("Test 5: computes duration as time between first and last sample in seconds", async () => {
      const { createCheckIn, CheckIn } = await import("../checkin");

      let capturedData: any;
      CheckIn.create = vi.fn().mockImplementation((data: any) => {
        capturedData = data;
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      // (1030000 - 1000000) / 1000 = 30 seconds
      expect(capturedData.duration).toBe(30);
    });

    it("Test 6: calls RunUser.patch to increment checkInCount and set lastCheckInAt", async () => {
      const { createCheckIn, CheckIn } = await import("../checkin");
      const { RunUser } = await import("../run-user");

      CheckIn.create = vi.fn().mockImplementation((data: any) => {
        return { go: vi.fn().mockResolvedValue({ data }) };
      });

      await createCheckIn("user-123", sampleData);

      expect(RunUser.patch).toHaveBeenCalledWith({ userId: "user-123" });
    });
  });

  describe("deleteCheckIn", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("Test 7: calls RunUser.patch to decrement checkInCount", async () => {
      const { deleteCheckIn, CheckIn } = await import("../checkin");
      const { RunUser } = await import("../run-user");

      CheckIn.delete = vi.fn().mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: {} }),
      });

      await deleteCheckIn("user-123", 1000000, "checkin-id-1");

      expect(RunUser.patch).toHaveBeenCalledWith({ userId: "user-123" });
      const patchResult = (RunUser.patch as any).mock.results[0].value;
      expect(patchResult.subtract).toHaveBeenCalledWith({ checkInCount: 1 });
    });
  });

  describe("getCheckInsByUser", () => {
    it("Test 8: queries byUserRecent index with desc order and cursor pagination", async () => {
      const { getCheckInsByUser, CheckIn } = await import("../checkin");

      const mockGo = vi.fn().mockResolvedValue({
        data: [{ userId: "user-123" }],
        cursor: "next-cursor",
      });

      CheckIn.query = {
        ...CheckIn.query,
        byUserRecent: vi.fn().mockReturnValue({
          go: mockGo,
        }),
      } as any;

      const result = await getCheckInsByUser("user-123", 10, "prev-cursor");

      expect(CheckIn.query.byUserRecent).toHaveBeenCalledWith({
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
      const { getRecentCheckIns, CheckIn } = await import("../checkin");

      const mockGo = vi.fn().mockResolvedValue({
        data: [{ checkInId: "ci-1" }],
        cursor: "next-cursor",
      });

      CheckIn.query = {
        ...CheckIn.query,
        byGlobalRecent: vi.fn().mockReturnValue({
          go: mockGo,
        }),
      } as any;

      const result = await getRecentCheckIns(5, "prev-cursor");

      expect(CheckIn.query.byGlobalRecent).toHaveBeenCalledWith({});
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
      const { updateCheckInPrivacy, CheckIn } = await import("../checkin");

      const mockSet = vi.fn().mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: {} }),
      });

      CheckIn.patch = vi.fn().mockReturnValue({
        set: mockSet,
      }) as any;

      await updateCheckInPrivacy("user-123", 1000000, "checkin-id-1", false);

      expect(CheckIn.patch).toHaveBeenCalledWith({
        userId: "user-123",
        timestamp: 1000000,
        checkInId: "checkin-id-1",
      });
      expect(mockSet).toHaveBeenCalledWith({ isPrivate: false });
    });
  });
});
