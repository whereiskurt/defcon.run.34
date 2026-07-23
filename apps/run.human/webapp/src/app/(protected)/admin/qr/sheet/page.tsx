import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import QrSheetDesigner from "@/components/admin/QrSheetDesigner";
import { cls } from "@/components/admin/qr-ui";
import { auth } from "@/config/auth";
import {
  ADMIN_GROUPS,
  QR_ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";

/**
 * /admin/qr/sheet — printable QR sheet designer (dc33 QRSheet port).
 * admin | runadmin render here; a qradmin-ONLY visitor is bounced to the
 * identical /user/qr/sheet twin (outside /admin/*, which edge/WAF rules may
 * wall off) with the ?url= prefill preserved. Everyone else → 404.
 * ?url=… prefills the designer; only absolute http(s) URLs are accepted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QrSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const { url } = await searchParams;
  const raw = typeof url === "string" ? url : "";
  const initialUrl = /^https?:\/\/\S+$/.test(raw) ? raw : "";
  const twin = `/user/qr/sheet${initialUrl ? `?url=${encodeURIComponent(initialUrl)}` : ""}`;

  const session = await auth();
  if (!requireGroups(session, ADMIN_GROUPS).ok) {
    // qradmin without admin/runadmin: same tool, non-/admin path.
    if (requireGroups(session, QR_ADMIN_GROUPS).ok) redirect(twin);
    notFound();
  }
  const authUserId = session?.user?.authUserId;
  if (!authUserId) notFound();
  if (!(await revalidateGroups(authUserId, ADMIN_GROUPS))) {
    // live claims lost admin/runadmin — still a live qradmin? bounce, else 404
    if (await revalidateGroups(authUserId, QR_ADMIN_GROUPS)) redirect(twin);
    notFound();
  }

  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <Link href="/admin/qr" className={`${cls.btn} self-start`}>
          ← QR / CTF
        </Link>
        <h1 className={cls.h1}>
          QR sheet designer<span className="teal-dot">.</span>
        </h1>
        <p className={cls.sub}>
          Style a QR code and download a printable US-Letter PDF - grids with
          fold lines, or Avery label stock. Everything renders in your browser.
        </p>
      </div>
      <QrSheetDesigner initialUrl={initialUrl} />
    </div>
  );
}
