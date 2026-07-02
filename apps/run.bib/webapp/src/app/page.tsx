import { redirect } from "next/navigation";

/**
 * Redirect the bare site root to /orderform.
 *
 * Kurt 2026-07-02: the "dangling" URL `bib.defcon.run/use1/` felt
 * incomplete; the canonical landing is `bib.defcon.run/use1/orderform`.
 * The actual bib registration page lives at `app/orderform/page.tsx`;
 * this file exists only so `/` (and by extension `/use1/`) round-trips
 * to the canonical URL.
 *
 * Next.js `redirect()` from a server component issues a 307, preserving
 * method + body — safe against accidental POST hits at the naked root.
 */
export default function RootPage() {
  redirect("/orderform");
}
