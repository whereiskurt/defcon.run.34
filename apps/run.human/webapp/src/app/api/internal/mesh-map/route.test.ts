import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/entities/run-user", () => ({
  scanAllRunUsers: vi.fn(),
}));
vi.mock("@/config", () => ({ config: { auth: { internalSecret: "s3cr3t" } } }));

import { scanAllRunUsers } from "@/entities/run-user";
import { GET } from "./route";

function req(secret?: string) {
  return { headers: { get: (k: string) => (k === "x-internal-secret" ? secret ?? null : null) } } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("internal mesh-map", () => {
  it("403s without the internal secret", async () => {
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
  it("returns only verified && showOnMap radios with numeric node ids", async () => {
    (scanAllRunUsers as any).mockResolvedValue([
      {
        displayName: "rabbit_9f2a", mqttUsertype: "rabbit", hash: "abc",
        preferences: { pinIcon: "star", pinColor: "#00d4aa" },
        meshtasticRadios: [
          { id: "1", nodeId: "!95347fc0", verified: true, showOnMap: true },
          { id: "2", nodeId: "!deadbeef", verified: true, showOnMap: false }, // opted out
          { id: "3", nodeId: "!12345678", verified: false, showOnMap: true }, // unverified
        ],
      },
      { displayName: "no_radios" },
    ]);
    const res = await GET(req("s3cr3t"));
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit",
      pinIcon: "star", pinColor: "#00d4aa", hash: "abc",
    });
  });
});
