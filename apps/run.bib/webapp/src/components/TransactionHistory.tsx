/**
 * TransactionHistory — read-only panel showing a runner's total contributed
 * plus each reconciled payment (bib sponsorships + donations). Server
 * component (no client JS). Venmo/CashApp entries only appear here once an
 * organizer reconciles them, so a note calls that out.
 */
export type Txn = {
  kind: "bib" | "donation";
  provider: string;
  amountCents: number;
  timestamp: string;
  // "pending" = a Venmo/CashApp intent not yet reconciled by an organizer.
  status: "reconciled" | "pending";
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(ts: string): string {
  // ISO8601 → "Jul 3" style, defensive against bad values.
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TransactionHistory({
  totalCents,
  txns,
}: {
  totalCents: number;
  txns: Txn[];
}) {
  if (totalCents <= 0 && txns.length === 0) return null;

  return (
    <section
      aria-label="Your contributions"
      style={{
        padding: 20,
        borderRadius: 14,
        backgroundColor: "#12121a",
        border: "1px solid #24242e",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#8f8fa8",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Total contributed
        </span>
        <span
          style={{
            fontSize: 34,
            fontWeight: 800,
            color: "#6CCDB8",
            fontFamily:
              "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
          }}
        >
          {usd(totalCents)}
        </span>
      </div>

      {txns.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {txns.map((t, i) => {
            const isPending = t.status === "pending";
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  backgroundColor: isPending ? "#1a160c" : "#0f0f16",
                  border: `1px solid ${isPending ? "#4a3d15" : "#24242e"}`,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    color: "#e4e4ef",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {t.kind === "bib" ? "Bib sponsorship" : "Donation"}
                  <span style={{ color: "#8f8fa8" }}>· {t.provider}</span>
                  {isPending && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "#E8B93A",
                        backgroundColor: "#3a2f0d",
                        border: "1px solid #5c4a15",
                        borderRadius: 999,
                        padding: "1px 8px",
                      }}
                    >
                      In progress
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ color: "#8f8fa8", fontSize: 13 }}>
                    {fmtDate(t.timestamp)}
                  </span>
                  <span
                    style={{
                      color: isPending ? "#E8B93A" : "#6CCDB8",
                      fontWeight: 700,
                      fontFamily:
                        "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
                    }}
                  >
                    {usd(t.amountCents)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p style={{ margin: 0, fontSize: 12, color: "#8f8fa8" }}>
        Venmo &amp; Cash App contributions appear here once an organizer
        confirms them.
      </p>
    </section>
  );
}
