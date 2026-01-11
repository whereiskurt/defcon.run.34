import { auth } from "@/config/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  // Check for gpxstudio service claim
  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    redirect("/access-denied");
  }

  // Redirect to the GPX Studio frontend
  redirect("/gpx");
}
