/**
 * AuthProfile service reads.
 *
 * Read-only helpers over the AuthProfile entity for internal/admin reporting.
 */

import { AuthProfile } from "@/entities/auth-profile";

/**
 * List every user's authorized services in ONE table scan.
 *
 * Scans the AuthProfile entity with `pages: "all"` and maps each row to
 * `{ sub, services }`, where `sub` is the AuthProfile `userId` (which IS the
 * OIDC sub) and `services` defaults to `[]` when the row omits it. This is a
 * read-only admin/analytics query (mirrors listQuotaByType) — no per-user
 * fan-out, no schema change.
 *
 * @returns One row per profile: { sub, services }
 */
export async function listAllProfileServices(): Promise<
  Array<{ sub: string; services: string[] }>
> {
  const result = await AuthProfile.scan.go({ pages: "all" });

  return result.data.map((row) => ({
    sub: row.userId,
    services: row.services ?? [],
  }));
}
