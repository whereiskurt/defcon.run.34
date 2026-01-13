import type { Metadata } from "next";
import { Providers } from "./providers";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
// SessionProvider basePath - full path for client-side browser requests
// (includes region prefix because browser needs the complete URL)
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

export const metadata: Metadata = {
  title: "GPX Studio - DEF CON",
  description: "GPX editor for DEF CON runners",
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
