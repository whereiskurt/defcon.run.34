import { auth } from "@/config/auth";
import { redirect } from "next/navigation";

export default async function GpxStudioPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    redirect("/access-denied");
  }

  // Redirect to the GPX Studio SvelteKit app
  redirect("/studio/app");
}
