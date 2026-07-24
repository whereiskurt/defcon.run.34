import { ImageResponse } from "next/og";

/**
 * 777-jackpot OG card for the CTF claim page (ghost magic links unfurl this
 * when pasted into a chat). Code-generated — no bundled image asset. An
 * EXPLICIT route handler (not the opengraph-image.tsx convention) so the
 * page's og:image URL can be built deterministically from RUN_PUBLIC_URL —
 * the convention derives its URL from metadataBase, which is fragile behind
 * this app's /{region} basePath + CloudFront.
 *
 * Copy mirrors the resolver's cherries theme: celebratory and deliberately
 * CODE-FREE — the flag code / nonce never appears here. The sevens are pure
 * CSS (no emoji glyphs) so rendering needs no external font/emoji fetch.
 */

export const runtime = "nodejs";
export const dynamic = "force-static";

const SIZE = { width: 1200, height: 630 };

const SLOT = {
  width: 180,
  height: 240,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(180deg, #fdf6e3 0%, #e8dcc0 100%)",
  borderRadius: 18,
  border: "6px solid #b8860b",
  color: "#c0182b",
  fontSize: 150,
  fontWeight: 800,
} as const;

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          background:
            "radial-gradient(circle at 50% 30%, #0f5132 0%, #062b1a 55%, #02150d 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 28 }}>
          <div style={SLOT}>7</div>
          <div style={SLOT}>7</div>
          <div style={SLOT}>7</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              color: "#ffd700",
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: 2,
            }}
          >
            JACKPOT — you found a flag!
          </div>
          <div style={{ color: "#d9e8df", fontSize: 32 }}>
            Tap in to claim your DEF CON 34 run CTF flag before the reels reset.
          </div>
        </div>
      </div>
    ),
    SIZE,
  );
}
