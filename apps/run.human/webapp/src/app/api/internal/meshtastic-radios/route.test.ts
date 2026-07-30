import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Authorization behavior of the internal flash register boundary.
 *
 * The hole this locks: a re-flash of a radio belonging to ANOTHER account used to
 * fall into the same-owner UPDATE patch -- overwriting the other user's key material,
 * flipping `verified`, leaving `userId` behind (so meshtk attributed the new radio's
 * traffic to the old account), and returning an ordinary 200 {updated:true} that the
 * flash wizard rendered as its normal success line. Completely silent.
 *
 * Owner mismatch is now an explicit, quota-charged, audited transfer.
 */

vi.mock("@/entities/client", () => ({
  dynamodbClient: { query: vi.fn() },
  DYNAMODB_TABLE: "run-human-authjs",
}));
vi.mock("@/entities/run-user", () => ({ getRunUser: vi.fn() }));
vi.mock("@/entities/mesh-radio", () => ({
  getMeshRadio: vi.fn(),
  upsertMeshRadio: vi.fn(),
  patchMeshRadio: vi.fn(),
  transferMeshRadioOwner: vi.fn(),
}));
vi.mock("@/entities/mesh-welcome-pending", () => ({ enqueueWelcome: vi.fn() }));
vi.mock("@/lib/quota-client", () => ({ consumeQuota: vi.fn() }));
vi.mock("@/lib/quota-middleware", () => ({ getUserTier: vi.fn(() => "default") }));
vi.mock("@/config", () => ({ config: { auth: { internalSecret: "s3cr3t" } } }));

import { dynamodbClient } from "@/entities/client";
import { getRunUser } from "@/entities/run-user";
import {
  getMeshRadio,
  upsertMeshRadio,
  patchMeshRadio,
  transferMeshRadioOwner,
} from "@/entities/mesh-radio";
import { consumeQuota } from "@/lib/quota-client";
import { POST } from "./route";

const OIDC_SUB = "oidc-sub-abc";
const OWNER = "041287e3-new-owner";
const OTHER_OWNER = "473d02cd-old-owner";
const NODE_ID = "!4359d0cc";

function req(body: unknown, secret: string | null = "s3cr3t") {
  return {
    headers: { get: (k: string) => (k === "x-internal-secret" ? secret : null) },
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const body = { oidcSub: OIDC_SUB, nodeId: NODE_ID, privateKey: "DEVICE_PRIVATE" };

/** A row owned by `userId`, as returned from the pre-write existence check. */
function row(userId: string) {
  return {
    nodeId: NODE_ID,
    nodeNum: 1130409164,
    userId,
    privateKey: "STORED_PRIVATE",
    verified: true,
    verificationCode: "314633",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Resolve OIDC sub -> adapter userId.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dynamodbClient.query as any).mockResolvedValue({ Items: [{ userId: OWNER }] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getRunUser as any).mockResolvedValue({ userId: OWNER, displayName: "runner" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (consumeQuota as any).mockResolvedValue({ success: true, remaining: 3 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (patchMeshRadio as any).mockImplementation(async () => row(OWNER));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (upsertMeshRadio as any).mockImplementation(async () => row(OWNER));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (transferMeshRadioOwner as any).mockImplementation(async () => row(OWNER));
});

describe("internal register: gate", () => {
  it("403s without the internal secret", async () => {
    const res = await POST(req(body, null));
    expect(res.status).toBe(403);
  });
});

describe("internal register: same owner (unchanged behavior)", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(row(OWNER));
  });

  it("patches keys in place and reports updated:true", async () => {
    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ updated: true });
    expect(json.transferred).toBeUndefined();
    expect(patchMeshRadio).toHaveBeenCalledWith(
      NODE_ID,
      expect.objectContaining({ privateKey: "DEVICE_PRIVATE", verified: true })
    );
    expect(transferMeshRadioOwner).not.toHaveBeenCalled();
  });

  it("does NOT charge quota for a re-flash of a radio you already own", async () => {
    await POST(req(body));
    expect(consumeQuota).not.toHaveBeenCalled();
  });
});

describe("internal register: cross-owner transfer", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(row(OTHER_OWNER));
  });

  it("transfers ownership instead of silently patching another user's row", async () => {
    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Distinguishable from a plain update -- this is the silent-success bug.
    expect(json.transferred).toBe(true);
    expect(json.updated).toBeUndefined();
    expect(transferMeshRadioOwner).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_OWNER }),
      OWNER,
      expect.objectContaining({ privateKey: "DEVICE_PRIVATE" })
    );
    // The old blind-patch path must not run.
    expect(patchMeshRadio).not.toHaveBeenCalled();
    expect(upsertMeshRadio).not.toHaveBeenCalled();
  });

  it("returns previousUserId for the internal audit trail", async () => {
    const json = await (await POST(req(body))).json();
    expect(json.previousUserId).toBe(OTHER_OWNER);
  });

  it("charges the NEW owner's radio quota (otherwise transfer is a quota bypass)", async () => {
    await POST(req(body));
    expect(consumeQuota).toHaveBeenCalledWith(OWNER, "meshtastic_radio", 1, "default");
  });

  it("403s Radio quota exceeded and does NOT transfer when the new owner is out of slots", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeQuota as any).mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(req(body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Radio quota exceeded" });
    // The victim's row must be untouched when the transfer is refused.
    expect(transferMeshRadioOwner).not.toHaveBeenCalled();
    expect(patchMeshRadio).not.toHaveBeenCalled();
  });

  it("never echoes the verificationCode secret back to the caller", async () => {
    const json = await (await POST(req(body))).json();
    expect(json.radio).toBeDefined();
    expect(json.radio.verificationCode).toBeUndefined();
  });
});

describe("internal register: create", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(undefined);
  });

  it("creates a new row, charges quota, and reports updated:false with 201", async () => {
    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({ updated: false });
    expect(json.transferred).toBeUndefined();
    expect(consumeQuota).toHaveBeenCalledWith(OWNER, "meshtastic_radio", 1, "default");
    expect(upsertMeshRadio).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, nodeId: NODE_ID, source: "flash" })
    );
    expect(transferMeshRadioOwner).not.toHaveBeenCalled();
  });

  it("403s when the user is out of radio slots", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeQuota as any).mockResolvedValue({ success: false, remaining: 0 });
    const res = await POST(req(body));
    expect(res.status).toBe(403);
    expect(upsertMeshRadio).not.toHaveBeenCalled();
  });
});

describe("internal register: the three outcomes are mutually distinguishable", () => {
  it("created / updated / transferred each produce a distinct response shape", async () => {
    const shapes: Record<string, unknown> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(undefined);
    shapes.created = await (await POST(req(body))).json();

    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dynamodbClient.query as any).mockResolvedValue({ Items: [{ userId: OWNER }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getRunUser as any).mockResolvedValue({ userId: OWNER });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeQuota as any).mockResolvedValue({ success: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patchMeshRadio as any).mockResolvedValue(row(OWNER));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(row(OWNER));
    shapes.updated = await (await POST(req(body))).json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transferMeshRadioOwner as any).mockResolvedValue(row(OWNER));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMeshRadio as any).mockResolvedValue(row(OTHER_OWNER));
    shapes.transferred = await (await POST(req(body))).json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flag = (o: any) => (o.transferred ? "transferred" : o.updated ? "updated" : "created");
    expect(flag(shapes.created)).toBe("created");
    expect(flag(shapes.updated)).toBe("updated");
    expect(flag(shapes.transferred)).toBe("transferred");
  });
});
