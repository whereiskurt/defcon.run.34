import Link from "next/link";

import { listQrCodes, listCtf, listQrTotals } from "@/lib/qr-admin";
import { cls, QR_ORIGIN } from "@/components/admin/qr-ui";
import { gateAdminPage } from "./gate";

/**
 * /admin/qr — QR / CTF code management (spec Phase 4). Lives in the (protected)
 * route group so it renders inside the real run.human chrome, matching the
 * AdminConsole rework. Gated identically to /admin (gateAdminPage → 404 on
 * denial). force-dynamic: always a live read of the shared table.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

export default async function QrAdminPage() {
  const { email } = await gateAdminPage();
  const [codes, challenges, totals] = await Promise.all([
    listQrCodes(),
    listCtf(),
    listQrTotals(),
  ]);

  const sortedCodes = [...codes].sort((a, b) => a.code.localeCompare(b.code));
  const sortedChallenges = [...challenges].sort((a, b) =>
    a.challenge.localeCompare(b.challenge)
  );

  return (
    <div className={cls.root}>
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className={cls.h1}>
            defcon<span className="teal-dot">.</span>run 34 · QR / CTF
          </h1>
          <p className={`${cls.sub} mt-1`}>
            Manage <span className="text-primary font-mono">{QR_ORIGIN}</span> codes
            {email ? ` · ${email}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/qr/sheet" className={cls.btn}>
            ⊞ Sheet designer
          </Link>
          <Link href="/admin" className={cls.btn}>
            ← Admin
          </Link>
        </div>
      </div>

      {/* QR codes */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className={cls.h2}>QR codes ({sortedCodes.length})</h2>
          <Link href="/admin/qr/new" className={cls.btnPrimary}>
            + New QR code
          </Link>
        </div>
        <div className={`${cls.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={`${cls.table} min-w-[720px]`}>
              <thead className={cls.thead}>
                <tr>
                  {["Code", "Destination", "Rules", "Enabled", "Scans", "Updated", "", ""].map(
                    (c, i) => (
                      <th key={c || i} className={cls.th}>
                        {c}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedCodes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-default-400 text-sm">
                      No codes yet. Create one to make a live q.defcon.run short link.
                    </td>
                  </tr>
                ) : (
                  sortedCodes.map((row) => (
                    <tr key={row.code} className={cls.tr}>
                      <td className={cls.td}>
                        <Link href={`/admin/qr/${row.code}`} className="text-primary">
                          {row.code}
                        </Link>
                      </td>
                      <td
                        className={`${cls.td} max-w-[340px] truncate`}
                        title={row.destination || ""}
                      >
                        {row.destination || "—"}
                      </td>
                      <td className={cls.td}>{row.rules?.length ?? 0}</td>
                      <td className={cls.td}>
                        {row.enabled ? (
                          <span className="text-primary">live</span>
                        ) : (
                          <span className="text-default-400">off</span>
                        )}
                      </td>
                      <td className={`${cls.td} tabular-nums`}>{totals[row.code] ?? 0}</td>
                      <td className={`${cls.td} text-default-500`}>{fmtDate(row.updatedAt)}</td>
                      <td className={cls.td}>
                        <Link
                          href={`/admin/qr/sheet?url=${encodeURIComponent(`${QR_ORIGIN}/${row.code}`)}`}
                          className="text-default-400"
                        >
                          sheet
                        </Link>
                      </td>
                      <td className={cls.td}>
                        <Link href={`/admin/qr/${row.code}`} className="text-default-400">
                          edit
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTF challenges */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className={cls.h2}>CTF challenges ({sortedChallenges.length})</h2>
          <Link href="/admin/qr/ctf/new" className={cls.btnPrimary}>
            + New CTF challenge
          </Link>
        </div>
        <div className={`${cls.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={`${cls.table} min-w-[560px]`}>
              <thead className={cls.thead}>
                <tr>
                  {["Challenge", "Points", "Max att.", "Enabled", "Updated", ""].map(
                    (c, i) => (
                      <th key={c || i} className={cls.th}>
                        {c}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedChallenges.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-default-400 text-sm">
                      No challenges yet.
                    </td>
                  </tr>
                ) : (
                  sortedChallenges.map((row) => (
                    <tr key={row.challenge} className={cls.tr}>
                      <td className={cls.td}>
                        <Link href={`/admin/qr/ctf/${row.challenge}`} className="text-primary">
                          {row.challenge}
                        </Link>
                      </td>
                      <td className={cls.td}>{row.points ?? "—"}</td>
                      <td className={cls.td}>{row.maxAttempts ?? "—"}</td>
                      <td className={cls.td}>
                        {row.enabled ? (
                          <span className="text-primary">on</span>
                        ) : (
                          <span className="text-default-400">off</span>
                        )}
                      </td>
                      <td className={`${cls.td} text-default-500`}>{fmtDate(row.updatedAt)}</td>
                      <td className={cls.td}>
                        <Link
                          href={`/admin/qr/ctf/${row.challenge}`}
                          className="text-default-400"
                        >
                          edit
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p className="text-[11.5px] text-default-400">
        Edits propagate to the live resolver within ~60s (warm cache). CTF rows feed
        the Phase-5 judge — the resolver forwards <code>/ctf/…</code> without reading
        them.
      </p>
    </div>
  );
}
