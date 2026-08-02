import Link from "next/link";

import { cls } from "@/components/admin/qr-ui";
import ClusterAdmin from "@/components/admin/ClusterAdmin";
import { getClusterConfig } from "@/lib/cluster-config-store";
import { DEMO_SCENARIOS } from "@/lib/cluster-demo";
import { gateAdminPage } from "../qr/gate";

/**
 * /admin/clusters — cluster check-in bonus control panel.
 *
 * Lives in the (protected) route group so it renders inside the real run.human
 * chrome, and is gated identically to /admin/qr (gateAdminPage → 404 on
 * denial, never a 403 — the route's existence is not advertised).
 *
 * The server component only loads the current config; every action (save,
 * preview, sweep, demo load/clear) is a client fetch against the admin API.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClustersAdminPage() {
  await gateAdminPage();
  const config = await getClusterConfig();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <h1 className={cls.h1}>Cluster check-ins</h1>
          <p className={cls.sub}>
            Bonus points when a crowd checks in at the same place at the same
            time — the morning corral, a social, an ad-hoc group on a run.
          </p>
        </div>
        <Link href="/admin" className={cls.btn}>
          &larr; Admin
        </Link>
      </div>

      <ClusterAdmin initial={config} />

      <section className={`${cls.cardPad} mt-5`}>
        <h2 className={cls.h2}>What the demo data seeds</h2>
        <p className={`${cls.sub} mt-1 mb-3`}>
          Check-ins are stamped onto con days (Aug 5&ndash;10 PDT), so before the
          con they are future-dated. The live sweep never touches them; only the
          whole-con sweep above does. Clearing walks an explicit manifest of what
          the seeder created.
        </p>
        <div className="overflow-x-auto">
          <table className={cls.table}>
            <thead className={cls.thead}>
              <tr>
                <th className={cls.th}>Scenario</th>
                <th className={cls.th}>Expected result</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_SCENARIOS.map((s) => (
                <tr key={s.key} className={cls.tr}>
                  <td className={`${cls.td} whitespace-normal`}>{s.label}</td>
                  <td className={`${cls.td} whitespace-normal`}>{s.expectation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
