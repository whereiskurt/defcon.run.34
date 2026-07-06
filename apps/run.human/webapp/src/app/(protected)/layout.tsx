import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { siteConfig } from "@site";
import { fontSans, fontMono, fontMuseo, fontAtkinson } from "@fonts";
import { SessionProvider } from "next-auth/react";
import { Header } from "@header";
import { Footer } from "@/components/footer";
import { MapBackground } from "@/components/map-background";
import { CopyProvider } from "@/components/CopyProvider";
import { loadCopy } from "@/lib/copy";
import { auth } from "@auth";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

const APP_VERSION_TOOLTIP = `DC34 ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

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

export default async function ProtectedRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const versionApp = process.env.NEXT_PUBLIC_VERSION_APP || 'unknown';
  const versionNginx = process.env.NEXT_PUBLIC_VERSION_NGINX || 'unknown';
  const session = await auth();

  // Phase 39 copy toolkit: resolve the merged copy map ONCE server-side (cached,
  // O(1) lookups thereafter) and hand ONLY the resolved map to the client
  // CopyProvider. The CMS token / URL are read inside loadCopy and never cross
  // the boundary. run.human has NO root layout, so both group layouts mount it.
  const copy = await loadCopy("default");

  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <meta name="version-app" content={versionApp} />
        <meta name="version-nginx" content={versionNginx} />
      </head>
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
            <CopyProvider value={copy}>
              <MapBackground />
              <div className="relative flex flex-col min-h-dvh noise-overlay">
                <div className="flex-shrink-0 relative z-10">
                  <Header session={session} />
                </div>
                <main className="container mx-auto max-w-[900px] px-6 flex-grow pt-3 pb-4 relative z-10">
                  {children}
                </main>
                <Footer versionTooltip={APP_VERSION_TOOLTIP} />
              </div>
            </CopyProvider>
          </SessionProvider>
        </Providers>
      </body>
    </html>
  );
}
