import { describe, it, expect } from "vitest";

import {
  createPending,
  CLAIM_LINK_TTL_SECONDS,
  type PendingStore,
  type PendingRow,
} from "../ctf-pending";

/**
 * ttlSeconds override on createPending — the ghost claim-link mint parks a
 * nonce with a SHORT ttl (CLAIM_LINK_TTL_SECONDS) instead of the 30-day
 * default, so a shared magic link goes stale quickly.
 */

function makeStore() {
  const rows = new Map<string, PendingRow>();
  const store: PendingStore = {
    async putPending(row) {
      rows.set(row.nonce, { ...row });
    },
    async getPending(nonce) {
      return rows.get(nonce) ?? null;
    },
    async deletePending(nonce) {
      rows.delete(nonce);
    },
  };
  return { store, rows };
}

describe("createPending ttlSeconds override", () => {
  it("uses the override when provided", async () => {
    const { store, rows } = makeStore();
    await createPending("goldstein", "X", {
      store,
      now: 0,
      ttlSeconds: 900,
      newNonce: () => "n1",
    });
    expect(rows.get("n1")!.ttl).toBe(900);
  });

  it("keeps the 30-day default when omitted", async () => {
    const { store, rows } = makeStore();
    await createPending("goldstein", "X", {
      store,
      now: 0,
      newNonce: () => "n2",
    });
    expect(rows.get("n2")!.ttl).toBe(30 * 24 * 60 * 60);
  });

  it("exports a 15-minute claim-link TTL", () => {
    expect(CLAIM_LINK_TTL_SECONDS).toBe(15 * 60);
  });
});
