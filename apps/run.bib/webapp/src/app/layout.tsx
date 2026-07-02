import type { Metadata } from "next";
import { Providers } from "./providers";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
// SessionProvider basePath - full path for client-side browser requests
// (includes region prefix because browser needs the complete URL)
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

export const metadata: Metadata = {
  title: "Get Your Bib · defcon.run 34",
  description:
    "defcon.run 34 bib registration for run.defcon.run participants",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Reset the default 8px body margin so the dark background reaches
       * the edges of the viewport (Kurt 2026-07-02 feedback: white border
       * around the page). Backgrounds on the landing/signin pages set the
       * dark colour inside the layout; this just makes them extend fully. */}
      <body style={{ margin: 0, backgroundColor: "#0a0a0a" }}>
        <Providers authBasePath={authBasePath}>{children}</Providers>
      </body>
    </html>
  );
}
