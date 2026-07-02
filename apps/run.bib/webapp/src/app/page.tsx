import { auth } from "@/config/auth";
import { redirect } from "next/navigation";

/**
 * Placeholder landing page for Phase 21 Plan 21-01.
 *
 * Plan 21-03 replaces this with the real bib registration UI
 * (BibForm + BibPreview + first-page-load POST /api/bib).
 */
export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    // Belt-and-suspenders — middleware should already have redirected.
    redirect("/signin");
  }

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e4e4ef",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p>Loading…</p>
    </main>
  );
}
