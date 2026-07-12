import SponsorForm from "@/components/SponsorForm";

/**
 * /donate — a standalone donation page (Kurt 2026-07-11). Renders the shared
 * DonateCard in its full modal presentation (kicker + coin art + title) via the
 * general-donation SponsorForm variant (POSTs /api/checkout/general, Stripe +
 * Venmo). Behind the app-wide auth middleware; CopyProvider is mounted in the
 * root layout so the client SponsorForm resolves copy here.
 */
export default function DonatePage() {
  return (
    <main
      style={{
        maxWidth: 440,
        margin: "0 auto",
        padding: "32px 16px 64px",
        boxSizing: "border-box",
      }}
    >
      <SponsorForm variant="general" presentation="page" />
    </main>
  );
}
