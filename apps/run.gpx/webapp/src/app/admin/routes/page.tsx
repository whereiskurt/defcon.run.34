import { notFound } from "next/navigation";
import { auth } from "@/config/auth";
import RoutesTable from "./RoutesTable";

/**
 * /admin/routes — community-route moderation (routes-vs-runs spec section 7).
 * Server-gated: anyone without the admin service sees the same 404 a missing
 * page would produce (non-disclosure).
 */
export default async function AdminRoutesPage() {
  const session = await auth();
  const services =
    (session?.user as { services?: string[] } | undefined)?.services ?? [];
  if (!session?.user?.id || !services.includes("admin")) {
    notFound();
  }

  return (
    <main style={{ maxWidth: 960, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>
        Community Routes — moderation
      </h1>
      <p style={{ color: "#666", marginBottom: "1rem" }}>
        Self-serve published routes. Unpublish pulls a route from the community
        layer immediately; the owner keeps their private copy.
      </p>
      <RoutesTable />
    </main>
  );
}
