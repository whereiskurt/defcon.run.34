import type { ScannerCopy } from "@/components/qr/QrScannerModal";

/** Resolver that returns the CMS value for `key`, or `fallback` if unset. */
export type CopyResolver = (key: string, fallback: string) => string;

/**
 * Copy for `QrScannerModal`, shared by /whoami and the landing page so the two
 * entry points cannot drift.
 *
 * The trigger BUTTON label is intentionally not built here — see the test.
 */
export function buildScannerCopy(copyOr: CopyResolver): ScannerCopy {
  return {
    title: copyOr("socialqr.scan.title", "Scan a runner"),
    hint: copyOr(
      "socialqr.scan.hint",
      "Point your camera at another runner's QR",
    ),
    miss: copyOr("socialqr.scan.miss", "Not a runner QR - keep it in frame"),
    found: copyOr("socialqr.scan.found", "🐰 Runner found!"),
    claim: copyOr("socialqr.scan.claim", "Claim connection"),
    again: copyOr("socialqr.scan.again", "Scan another"),
    unavailable: copyOr(
      "socialqr.scan.unavailable",
      "Camera unavailable - use your phone's camera app on the QR instead.",
    ),
    cancel: copyOr("socialqr.scan.cancel", "Done"),
  };
}
