import "@/styles/globals.css";
import type { Metadata, Viewport } from "next";
import clsx from "clsx";

import { Providers } from "./providers";
import { auth } from "@/config/auth";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { MapBackground } from "@/components/map-background";
import {
  fontSans,
  fontMono,
  fontMuseo,
  fontAtkinson,
} from "@/config/fonts";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
// SessionProvider basePath — full path for client-side browser requests
// (includes region prefix because the browser needs the complete URL).
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

export const metadata: Metadata = {
  title: "defcon.run 34 · Bib",
  description:
    "defcon.run 34 bib registration for run.defcon.run participants",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user as
    | { name?: string | null; email?: string | null; services?: string[] }
    | undefined;
  const userName = user?.name || user?.email || null;
  const isAdmin = Array.isArray(user?.services) && user.services.includes("admin");
  const versionApp = process.env.NEXT_PUBLIC_VERSION_APP || "dev";

  return (
    <html suppressHydrationWarning lang="en">
      <body
        className={clsx(
          "bg-background font-sans antialiased text-foreground",
          fontSans.variable,
          fontMono.variable,
          fontMuseo.variable,
          fontAtkinson.variable
        )}
      >
        <Providers
          themeProps={{ attribute: "class", defaultTheme: "dark" }}
          authBasePath={authBasePath}
        >
          <MapBackground />
          <div className="relative flex flex-col min-h-dvh noise-overlay">
            <div className="flex-shrink-0 relative z-10">
              <Header userName={userName} isAdmin={isAdmin} />
            </div>
            <main className="relative z-10 flex-grow">{children}</main>
            <Footer versionTooltip={`DC34 ${versionApp}`} />
          </div>
        </Providers>
      </body>
    </html>
  );
}
