import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/entities/mesh-radio", () => ({
  scanAllMeshRadios: vi.fn(),
}));
vi.mock("@/entities/run-user", () => ({
  scanAllRunUsers: vi.fn(),
}));
vi.mock("@/config", () => ({ config: { auth: { internalSecret: "s3cr3t" } } }));

import { scanAllMeshRadios } from "@/entities/mesh-radio";
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
  it("returns only verified && showOnMap MeshRadio rows, joined to user identity", async () => {
    (scanAllMeshRadios as any).mockResolvedValue([
      // verified + showOnMap → emitted; carries key material that MUST NOT leak
      { nodeId: "!95347fc0", nodeNum: 2503245760, userId: "u1", verified: true, showOnMap: true, privateKey: "PRIV_LEAK", publicKey: "PUB_LEAK" },
      // opted out of the map
      { nodeId: "!deadbeef", nodeNum: 3735928559, userId: "u1", verified: true, showOnMap: false },
      // not yet verified
      { nodeId: "!12345678", nodeNum: 305419896, userId: "u1", verified: false, showOnMap: true },
      // verified+showOnMap but the owning user has no RunUser row → default name
      { nodeId: "!00000001", nodeNum: 1, userId: "ghost", verified: true, showOnMap: true },
    ]);
    (scanAllRunUsers as any).mockResolvedValue([
      {
        userId: "u1", displayName: "rabbit_9f2a", mqttUsertype: "rabbit", hash: "abc",
        mqttUsername: "MQTT_USER_LEAK", mqttPassword: "MQTT_PASS_LEAK",
        preferences: { pinIcon: "star", pinColor: "#00d4aa" },
      },
    ]);
    const res = await GET(req("s3cr3t"));
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      nodeNum: 2503245760, displayName: "rabbit_9f2a", userType: "rabbit",
      pinIcon: "star", pinColor: "#00d4aa",
    });
    // Radio for a user with no RunUser row falls back to the default identity.
    expect(body.entries[1]).toMatchObject({ nodeNum: 1, displayName: "a rabbit" });
    // hash / user id / key material must never reach the map feed.
    expect(body.entries[0]).not.toHaveProperty("hash");
    expect(body.entries[0]).not.toHaveProperty("userId");
    expect(body.entries[0]).not.toHaveProperty("privateKey");
    expect(body.entries[0]).not.toHaveProperty("publicKey");
    expect(body.entries[0]).not.toHaveProperty("mqttUsername");
    expect(body.entries[0]).not.toHaveProperty("mqttPassword");
    expect(JSON.stringify(body)).not.toMatch(/LEAK/);
  });
});
