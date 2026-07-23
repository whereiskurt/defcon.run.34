import type { Metadata } from "next";
import { Providers } from "./providers";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
// SessionProvider basePath - full path for client-side browser requests
// (includes region prefix because browser needs the complete URL)
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

// Unfurl copy mirrors the root index.html og.* block (single card for the
// whole site). Absolute image URL — basePath (/use1) would mangle a relative
// one, and the PNG is served from the S3 assets prefix, not the app.
const OG_TITLE = "DEF CON 34 Maps — Run the Routes";
const OG_DESCRIPTION =
  "Official DEF CON 34 running routes on a 3D Vegas map. Download the GPX, chase the rabbits, mind the ghosts.";
const OG_IMAGE = "https://gpx.defcon.run/use1/assets/public/gpx-card.png";

export const metadata: Metadata = {
  metadataBase: new URL("https://gpx.defcon.run"),
  title: "GPX Studio - DEF CON",
  description: "GPX editor for DEF CON runners",
  openGraph: {
    type: "website",
    siteName: "defcon.run",
    url: "https://gpx.defcon.run/",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers authBasePath={authBasePath}>{children}</Providers>
      </body>
    </html>
  );
}
