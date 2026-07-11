/**
 * BibLockMeter — the "name locks Jul 23" urgency bar on the order page.
 *
 * Server component (no client JS): computes the fill fraction and heat from the
 * live date at render time. A full green→red gradient spans the whole track and
 * is revealed up to "now"; the un-elapsed remainder is masked dark, with a white
 * leading edge marking today. Border/glow/countdown all warm toward red as the
 * Jul 23 midnight (Vegas) lock approaches. Past the deadline it renders nothing —
 * the name is already locked and the existing lockedHint copy takes over.
 *
 * No animation → nothing to gate behind prefers-reduced-motion.
 */

// Vegas is UTC-7 (PDT) during the event. "Jul 23 at midnight" = the instant the
// 23rd ends, i.e. Jul 24 00:00 PDT = Jul 24 07:00 UTC. The window opens Jul 11.
const START_MS = Date.UTC(2026, 6, 11, 7, 0, 0); // Jul 11 00:00 PDT
const LOCK_MS = Date.UTC(2026, 6, 24, 7, 0, 0); // Jul 24 00:00 PDT (end of Jul 23)
const DAY_MS = 86_400_000;

/** green → amber → red ramp; f in [0,1]. */
function ramp(f: number): string {
  const x = Math.max(0, Math.min(1, f));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [53, 208, 122]],
    [0.5, [255, 210, 63]],
    [1, [255, 59, 59]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const t = (x - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export default function BibLockMeter({ label }: { label: string }) {
  const now = Date.now();

  // Past the lock → name is frozen; don't show a stale red bar forever.
  if (now >= LOCK_MS) return null;

  const frac = Math.max(0, Math.min(1, (now - START_MS) / (LOCK_MS - START_MS)));
  const shown = Math.max(0.03, frac); // keep the leading edge visible on day 1
  const heat = ramp(frac);
  const daysLeft = Math.max(1, Math.ceil((LOCK_MS - now) / DAY_MS));
  const soon = daysLeft <= 2;
  const pct = `${(shown * 100).toFixed(2)}%`;

  return (
    <div
      style={{
        borderRadius: 14,
        padding: "14px 16px",
        background:
          "linear-gradient(180deg, var(--bib-surface), var(--bib-surface-2))",
        border: `1px solid color-mix(in srgb, ${heat} 45%, var(--bib-border))`,
        boxShadow: `0 10px 34px -16px ${heat}, 0 0 0 1px color-mix(in srgb, ${heat} 20%, transparent)`,
      }}
    >
      {/* header: label on the left; the countdown + big JUL 23 date anchor at
        * the far right (the deadline is the thing we want to shout). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: "var(--bib-ink)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {label}
          <span
            style={{
              font: "700 12px/1 ui-monospace, Menlo, monospace",
              fontVariantNumeric: "tabular-nums",
              color: heat,
              textTransform: soon ? "uppercase" : "none",
              letterSpacing: soon ? "0.06em" : "normal",
            }}
          >
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left
          </span>
        </span>
        <span
          aria-hidden
          style={{
            width: 52,
            height: 58,
            flex: "none",
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid color-mix(in srgb, ${heat} 40%, var(--bib-border-2))`,
            background: "var(--bib-raise)",
            display: "flex",
            flexDirection: "column",
            textAlign: "center",
            boxShadow: `0 4px 14px -6px ${heat}`,
          }}
        >
          <span
            style={{
              font: "800 11px/17px system-ui",
              letterSpacing: "0.1em",
              background: heat,
              color: "#0a0a10",
            }}
          >
            JUL
          </span>
          <span
            style={{
              font: "800 28px/40px ui-monospace, Menlo, monospace",
              color: "var(--bib-ink)",
            }}
          >
            23
          </span>
        </span>
      </div>

      {/* the bar: full ramp revealed up to now, dark ahead, white leading edge */}
      <div
        style={{
          position: "relative",
          height: 20,
          borderRadius: 999,
          overflow: "hidden",
          background: "#16161f",
          border: "1px solid #26262f",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, #35d07a 0%, #9ede3a 28%, #ffd23f 52%, #ff8a1e 76%, #ff3b3b 100%)",
          }}
        />
        {/* mask the un-elapsed remainder */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: pct,
            right: 0,
            background: "#16161f",
          }}
        />
        {/* leading edge */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: pct,
            width: 2,
            transform: "translateX(-2px)",
            background: "#fff",
            boxShadow: `0 0 8px 1px ${heat}`,
          }}
        />
      </div>

      {/* ticks: start / now / end */}
      <div
        style={{
          position: "relative",
          height: 12,
          marginTop: 6,
          font: "600 9px/1 ui-monospace, Menlo, monospace",
          color: "var(--bib-faint)",
        }}
      >
        <span style={{ position: "absolute", left: 1 }}>JUL 11</span>
        <span
          style={{
            position: "absolute",
            left: pct,
            transform: "translateX(-50%)",
            color: heat,
            fontWeight: 700,
          }}
        >
          NOW
        </span>
        <span style={{ position: "absolute", right: 1 }}>JUL 23</span>
      </div>
    </div>
  );
}
