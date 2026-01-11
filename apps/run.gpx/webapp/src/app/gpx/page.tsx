import { auth } from "@/config/auth";
import { redirect } from "next/navigation";

export default async function GpxStudioPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  const mapboxToken = (session.user as { mapboxPublicToken?: string }).mapboxPublicToken;

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#1a1a1a",
      color: "#fff",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ marginBottom: "1rem" }}>GPX Studio - DEF CON</h1>

      <div style={{
        backgroundColor: "#2a2a2a",
        padding: "1.5rem",
        borderRadius: "8px",
        marginBottom: "1rem"
      }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>Session Info</h2>
        <p><strong>User ID:</strong> {session.user.id}</p>
        <p><strong>Email:</strong> {session.user.email}</p>
        <p><strong>Name:</strong> {session.user.name}</p>
        <p><strong>Services:</strong> {services.join(", ")}</p>
        <p><strong>Mapbox Token:</strong> {mapboxToken ? "Set" : "Using default"}</p>
      </div>

      <div style={{
        backgroundColor: "#2a2a2a",
        padding: "1.5rem",
        borderRadius: "8px"
      }}>
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.2rem" }}>Status</h2>
        <p style={{ color: "#4ade80" }}>Authentication working!</p>
        <p style={{ color: "#facc15", marginTop: "0.5rem" }}>
          GPX Studio frontend integration pending - this is a placeholder page.
        </p>
      </div>

      <form action="/api/auth/signout" method="POST" style={{ marginTop: "1.5rem" }}>
        <button
          type="submit"
          style={{
            backgroundColor: "#dc2626",
            color: "#fff",
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
