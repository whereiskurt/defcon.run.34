import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { siteConfig } from "@/config/site";
import { fontSans, fontMono, fontMuseo, fontAtkinson } from "@/config/fonts";
import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/header/header";
import SilentSSO from "@/components/SilentSSO";
import { loadCopy } from "@/lib/copy";
import { CopyProvider } from "@/components/CopyProvider";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the merged copy map ONCE server-side (cached, 300s revalidate).
  // The CMS token / URL are read inside loadCopy and never cross to the client —
  // only the resolved map is handed to <CopyProvider>. Absent CMS env → the app
  // floors to the committed copy-snapshot.json.
  const copy = await loadCopy("default");

  return (
    <html suppressHydrationWarning lang="en">
      <body
        className={clsx(
          "bg-background font-sans antialiased",
          fontSans.variable,
          fontMono.variable,
          fontMuseo.variable,
          fontAtkinson.variable,
        )}
      >
        <Providers themeProps={{ attribute: "class", defaultTheme: "dark" }}>
          <SessionProvider basePath={authBasePath}>
            {/* App-wide hidden-iframe silent-SSO probe (self-gates on unauthenticated). */}
            <SilentSSO />
            <CopyProvider value={copy}>
              <div className="relative flex flex-col min-h-dvh noise-overlay">
                <Header />
                <main className="container mx-auto max-w-6xl px-6 pt-4 flex-grow relative z-10">
                  {children}
                </main>
              </div>
            </CopyProvider>
          </SessionProvider>
        </Providers>
      </body>
    </html>
  );
}
