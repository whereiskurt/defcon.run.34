import { notFound } from "next/navigation";
import { auth } from "@/config/auth";
import HeatmapTable from "./HeatmapTable";

/**
 * /admin/heatmap — moderation for the public anonymous heat map.
 * Server-gated: anyone without the admin service sees the same 404 a missing
 * page would produce (non-disclosure).
 */
export default async function AdminHeatmapPage() {
  const session = await auth();
  const services =
    (session?.user as { services?: string[] } | undefined)?.services ?? [];
  if (!session?.user?.id || !services.includes("admin")) {
    notFound();
  }

  return (
    <main
      style={{
        maxWidth: 1040,
        margin: "2rem auto",
        padding: "0 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>
        Heat map — moderation
      </h1>
      <p style={{ color: "#666", marginBottom: "1rem" }}>
        Every con-day run that feeds the public heat map. The published artifact
        is non-attributable by design, so this is the only place a shape on the
        map can be traced back to the run that drew it. Hide is reversible;
        Delete removes the run outright. Neither takes effect publicly until you
        press <strong>Regenerate</strong>.
      </p>
      <HeatmapTable />
    </main>
  );
}
