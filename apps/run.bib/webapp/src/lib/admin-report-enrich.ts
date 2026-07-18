/**
 * CSV enrichment for the admin print-names report (Kurt 2026-07-11;
 * email re-sourced to run.auth 2026-07-18).
 *
 * The pure builder (admin-reports.buildReports) is AWS-/network-free. We fetch
 * two things here — ONLY for the print-names CSV download (the bib-vendor
 * handoff), never on the live dashboard:
 *   - email  ← run.auth (getRunnerEmail): the AUTHORITATIVE login email. A bib
 *     stores only ownerSub and run.bib has no adapter, so run.auth — where every
 *     bib owner authenticated — is the one source that has an email for EVERY
 *     bib. (It previously came from run.human, which only has it if the runner
 *     also used the main app, leaving bib-only runners blank.)
 *   - qrUrl  ← run.human (getSocialQrHash): the per-user social-QR hash lives on
 *     run.human's RunUser, so that stays a run.human lookup.
 * The two are independent now, so a run.human miss no longer blanks the email.
 * Fail-open: any per-runner miss yields blank cells so a slow or down upstream
 * never breaks the download.
 */

import type { PrintNameRow } from "@/lib/admin-reports";
import { getSocialQrHash, buildSocialQrUrl } from "@/lib/social-qr";
import { getRunnerEmail } from "@/lib/runner-email";

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
 * Enrich print-name rows with `email` (from run.auth) + `qrUrl` (from run.human).
 * Returns NEW row objects (does not mutate input). A row with no ownerSub, or any
 * lookup failure, gets a blank ("") value for that field independently.
 */
export async function enrichPrintNames(
  rows: PrintNameRow[],
  limit = 8
): Promise<PrintNameRow[]> {
  return mapWithConcurrency(rows, limit, async (row) => {
    if (!row.ownerSub) return { ...row, email: "", qrUrl: "" };
    // Independent, concurrent: email from run.auth, QR hash from run.human. One
    // being down/blank must not blank the other.
    const [email, hash] = await Promise.all([
      getRunnerEmail(row.ownerSub),
      getSocialQrHash(row.ownerSub),
    ]);
    return {
      ...row,
      email: email ?? "",
      qrUrl: hash ? buildSocialQrUrl(hash) : "",
    };
  });
}
