import { auth } from "@/config/auth";
import { redirect } from "next/navigation";
import { BrowserGate } from "@/components/browser-gate";
import { WizardContainer } from "@/components/wizard/wizard-container";

export default async function FlashPage() {
  // Server-side auth check for root page (middleware excluded via .+ matcher)
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("flash")) {
    redirect("/access-denied");
  }

  return (
    <BrowserGate>
      <WizardContainer />
    </BrowserGate>
  );
}
