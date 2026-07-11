/**
 * CSV enrichment for the admin print-names report (Kurt 2026-07-11).
 *
 * The pure builder (admin-reports.buildReports) is AWS-/network-free. Email and
 * the runner's social-QR URL live in run.human, so we fetch them here — ONLY for
 * the print-names CSV download (the bib-vendor handoff), never on the live
 * dashboard. Fail-open: any per-runner miss yields blank cells so a slow or down
 * run.human never breaks the download.
 */

import type { PrintNameRow } from "@/lib/admin-reports";
import { getRunnerContact, buildSocialQrUrl } from "@/lib/social-qr";

/**
 * Order-preserving map with a hard concurrency cap. Keeps the N internal HTTP
 * calls bounded (default caller passes 8) so a full-roster CSV doesn't fan out
 * hundreds of simultaneous requests at run.human.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Enrich print-name rows with `email` + `qrUrl` fetched from run.human. Returns
 * NEW row objects (does not mutate input). A row with no ownerSub, or any lookup
 * failure, gets blank ("") email/qrUrl.
 */
export async function enrichPrintNames(
  rows: PrintNameRow[],
  limit = 8
): Promise<PrintNameRow[]> {
  return mapWithConcurrency(rows, limit, async (row) => {
    if (!row.ownerSub) return { ...row, email: "", qrUrl: "" };
    const { hash, email } = await getRunnerContact(row.ownerSub);
    return {
      ...row,
      email: email ?? "",
      qrUrl: hash ? buildSocialQrUrl(hash) : "",
    };
  });
}
