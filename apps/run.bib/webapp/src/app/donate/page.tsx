import SponsorForm from "@/components/SponsorForm";

/**
 * /donate — a standalone donation page (Kurt 2026-07-11). Renders the same
 * shared DonateCard control set the header modal + Sponsor tile use, via the
 * general-donation SponsorForm variant (POSTs /api/checkout/general, Stripe +
 * Venmo). This is the canonical "give" surface every donate entry point points
 * at. Behind the app-wide auth middleware like the rest of the app; CopyProvider
 * is mounted in the root layout, so the client SponsorForm resolves copy here.
 */
export default function DonatePage() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "28px 16px 64px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #13131c, #0f0f17)",
          border: "1px solid #24242f",
          borderRadius: 18,
          padding: "22px 18px 20px",
          boxShadow: "0 30px 70px -30px #000",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#e7e7f1" }}>
            Support defcon.run
          </h1>
          <p style={{ margin: "8px auto 0", maxWidth: "40ch", color: "#8f8fa8", fontSize: 13.5 }}>
            defcon.run is a FREE daily event — chip in to help cover bibs, swag,
            and the morning meetups at the Spot.
          </p>
        </div>
        <SponsorForm variant="general" />
      </div>
    </main>
  );
}
