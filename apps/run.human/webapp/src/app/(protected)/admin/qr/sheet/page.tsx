import Link from "next/link";

import QrSheetDesigner from "@/components/admin/QrSheetDesigner";
import { cls } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../gate";

/**
 * /admin/qr/sheet — printable QR sheet designer (dc33 QRSheet port). Gated
 * like every /admin/qr surface (admin | runadmin | qradmin → else 404).
 * ?url=… prefills the designer; only absolute http(s) URLs are accepted.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QrSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  await gateAdminPage();
  const { url } = await searchParams;
  const raw = typeof url === "string" ? url : "";
  const initialUrl = /^https?:\/\/\S+$/.test(raw) ? raw : "";

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
          Style a QR code and download a printable US-Letter PDF — grids with
          fold lines, or Avery label stock. Everything renders in your browser.
        </p>
      </div>
      <QrSheetDesigner initialUrl={initialUrl} />
    </div>
  );
}
