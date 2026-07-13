import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import {
  ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";

/**
 * Shared /admin/qr page gate. Mirrors src/app/admin/page.tsx: sync group
 * check, then a LIVE revalidation keyed by the OIDC sub
 * (session.user.authUserId — NOT the adapter id). Admits ADMIN_GROUPS only
 * (admin | runadmin) — qradmin deliberately does NOT open anything under
 * /admin/* so edge/WAF rules can wall the whole area off; qradmin operators
 * use /user/qr/sheet instead (the sheet page bounces them there). Every
 * denial → notFound() (404), never a 403, so the route's existence is not
 * advertised. Returns the admin's email for the header when admitted.
 */
export async function gateAdminPage(): Promise<{ email: string | null }> {
  const session = await auth();
  const gate = requireGroups(session, ADMIN_GROUPS);
  if (!gate.ok) notFound();

  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, ADMIN_GROUPS)))
    notFound();

  return { email: gate.email };
}
