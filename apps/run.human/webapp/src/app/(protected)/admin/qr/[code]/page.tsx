import Link from "next/link";
import { notFound } from "next/navigation";

import { getQr, getQrStats } from "@/lib/qr-admin";
import QrForm, { type QrRecord } from "@/components/admin/QrForm";
import { cls, QR_ORIGIN } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../gate";

/**
 * /admin/qr/[code] — edit a QR code + read-only scan analytics. Gated. 404s if
 * the code does not exist (the static /admin/qr/new route handles creates).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QrEditPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await gateAdminPage();
  const { code } = await params;

  const record = await getQr(code);
  if (!record) notFound();
  const stats = await getQrStats(code);

  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Link href="/admin/qr" className={cls.btn}>
            ← QR / CTF
          </Link>
          <Link
            href={`/admin/qr/sheet?url=${encodeURIComponent(`${QR_ORIGIN}/${record.code}`)}`}
            className={cls.btnPrimary}
          >
            ⊞ Print sheet
          </Link>
        </div>
        <h1 className={cls.h1}>
          Edit code <span className="text-primary font-mono">{record.code}</span>
        </h1>
      </div>

      <QrForm mode="edit" initial={record as QrRecord} />

      {/* Scan analytics (read-only, from Qrstat) */}
      <section className="flex flex-col gap-2.5">
        <h2 className={cls.h2}>Scan analytics</h2>
        <div className={`${cls.cardPad} flex items-baseline gap-3`}>
          <span className="text-3xl font-semibold tabular-nums leading-none">
            {stats.total}
          </span>
          <span className="text-sm text-default-500">total scans</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTable
            title="By day"
            cols={["Date", "Scans"]}
            rows={stats.days.map((d) => [d.date, String(d.count)])}
          />
          <StatTable
            title="By param (?p=)"
            cols={["Value", "Scans"]}
            rows={stats.params.map((p) => [p.value, String(p.count)])}
          />
          <StatTable
            title="By CTF handoff"
            cols={["Challenge", "Count"]}
            rows={stats.ctf.map((c) => [c.challenge, String(c.count)])}
          />
        </div>
        <p className="text-[11.5px] text-default-400">
          Counters are updated by the rollup Lambda every ~30 min from resolver logs —
          recent scans may not appear yet.
        </p>
      </section>
    </div>
  );
}

function StatTable({
  title,
  cols,
  rows,
}: {
  title: string;
  cols: [string, string];
  rows: string[][];
}) {
  return (
    <div className={`${cls.card} overflow-hidden`}>
      <div className="px-3.5 py-2.5 text-[11px] uppercase tracking-wide text-default-400 font-semibold border-b border-divider">
        {title}
      </div>
      <table className={cls.table}>
        <thead className={cls.thead}>
          <tr>
            {cols.map((c) => (
              <th key={c} className={cls.th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="p-4 text-default-400 text-sm">
                No data.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r[0]}-${i}`} className="border-t border-divider">
                <td className={`${cls.td} max-w-[160px] truncate`} title={r[0]}>
                  {r[0]}
                </td>
                <td className={`${cls.td} tabular-nums`}>{r[1]}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
