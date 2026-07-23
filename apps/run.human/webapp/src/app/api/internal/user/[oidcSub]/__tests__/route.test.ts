import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockGet = vi.fn();
const mockGetRunUser = vi.fn();
const mockUpdate = vi.fn();
const mockEnsure = vi.fn();
const mockGetAuthEmail = vi.fn();

vi.mock("@/entities/client", () => ({
  dynamodbClient: {
    query: (...a: unknown[]) => mockQuery(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
  DYNAMODB_TABLE: "test-table",
}));
vi.mock("@/entities/run-user", () => ({
  getRunUser: (...a: unknown[]) => mockGetRunUser(...a),
  updateRunUserProfile: (...a: unknown[]) => mockUpdate(...a),
}));
vi.mock("@/lib/ensure-identity", () => ({
  ensureRunHumanIdentity: (...a: unknown[]) => mockEnsure(...a),
}));
vi.mock("@/entities/runner-token", () => ({
  ensureRunnerToken: vi.fn(async (_userId: string, hash: string) =>
    hash.slice(0, 16)
  ),
}));
vi.mock("@/lib/auth-email", () => ({
  getAuthEmailBySub: (...a: unknown[]) => mockGetAuthEmail(...a),
}));
vi.mock("@/config", () => ({
  config: { auth: { internalSecret: "s3cret" } },
}));

import { PATCH } from "../route";
import type { NextRequest } from "next/server";

function req(
  secret: string | null,
  body: unknown,
  oidcSub = "oidc-1"
): { request: NextRequest; params: Promise<{ oidcSub: string }> } {
  return {
    request: {
      headers: { get: (k: string) => (k === "x-internal-secret" ? secret : null) },
      json: async () => body,
    } as unknown as NextRequest,
    params: Promise.resolve({ oidcSub }),
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGet.mockReset();
  mockGetRunUser.mockReset();
  mockUpdate.mockReset();
  mockEnsure.mockReset();
  mockGetAuthEmail.mockReset();
  // Default: account lookup resolves to adapter user "adapter-abcd1234".
  mockQuery.mockResolvedValue({ Items: [{ userId: "adapter-abcd1234" }] });
});

describe("PATCH /api/internal/user/[oidcSub]", () => {
  it("403s without the internal secret", async () => {
    const { request, params } = req(null, { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // --- Provisioning (bib-only runner with no run.human account) --------------

  it("provisions a missing identity (email from run.auth) then syncs the name", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] }); // no account maps to the sub
    mockGetAuthEmail.mockResolvedValue("a@x.com");
    mockEnsure.mockResolvedValue({ userId: "new-uid", created: true });
    mockGetRunUser.mockResolvedValue({
      userId: "new-uid",
      displayName: "rabbit_newu",
      displayNameManual: false, // explicitly unlocked → sync proceeds
    });

    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();

    expect(mockEnsure).toHaveBeenCalledWith("oidc-1", "a@x.com", "OGRE");
    expect(mockUpdate).toHaveBeenCalledWith("new-uid", {
      displayName: "OGRE",
      displayNameManual: false,
    });
    expect(body).toEqual({ synced: true, displayName: "OGRE", provisioned: true });
  });

  it("skips (no_identity_no_email) when the sub has no account and run.auth has no email", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    mockGetAuthEmail.mockResolvedValue(null);

    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ synced: false, reason: "no_identity_no_email" });
    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still provisions the identity when the name is too short to sync", async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    mockGetAuthEmail.mockResolvedValue("a@x.com");
    mockEnsure.mockResolvedValue({ userId: "new-uid", created: true });

    const { request, params } = req("s3cret", { displayName: "ab" });
    const res = await PATCH(request, { params });
    const body = await res.json();

    expect(mockEnsure).toHaveBeenCalled();
    expect(body).toEqual({ synced: false, reason: "too_short", provisioned: true });
    expect(mockGetRunUser).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // --- Existing-account name sync (unchanged behavior + provisioned:false) ----

  it("skips (synced:false) a too-short name without provisioning or touching the user", async () => {
    const { request, params } = req("s3cret", { displayName: "ab" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ synced: false, reason: "too_short", provisioned: false });
    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockGetRunUser).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips (synced:false, manual) when displayNameManual is true", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "ChosenName",
      displayNameManual: true,
    });
    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: false, reason: "manual", provisioned: false });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips (manual) by heuristic when flag absent and name is non-default", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "KPH", // != the auto-default rabbit_adap (slice(0,4) of adapter id)
    });
    const { request, params } = req("s3cret", { displayName: "OGRE" });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: false, reason: "manual", provisioned: false });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("overwrites (synced:true) an unclaimed default name and stamps manual:false", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "rabbit_adap", // exact auto-default (slice(0,4) of adapter id)
    });
    mockUpdate.mockResolvedValue(undefined);
    const { request, params } = req("s3cret", { displayName: "  OGRE  " });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body).toEqual({ synced: true, displayName: "OGRE", provisioned: false });
    expect(mockUpdate).toHaveBeenCalledWith("adapter-abcd1234", {
      displayName: "OGRE",
      displayNameManual: false,
    });
  });

  it("truncates a > 20 char name before writing", async () => {
    mockGetRunUser.mockResolvedValue({
      userId: "adapter-abcd1234",
      displayName: "rabbit_abcd",
      displayNameManual: false,
    });
    mockUpdate.mockResolvedValue(undefined);
    const { request, params } = req("s3cret", {
      displayName: "abcdefghijklmnopqrstuvwx",
    });
    const res = await PATCH(request, { params });
    const body = await res.json();
    expect(body.displayName).toBe("abcdefghijklmnopqrst");
    expect(mockUpdate).toHaveBeenCalledWith("adapter-abcd1234", {
      displayName: "abcdefghijklmnopqrst",
      displayNameManual: false,
    });
  });
});
