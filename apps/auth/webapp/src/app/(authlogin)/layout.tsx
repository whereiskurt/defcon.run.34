import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { siteConfig } from "@site";
import { fontSans } from "@fonts";
import { SessionProvider } from "next-auth/react";

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
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const versionApp = process.env.NEXT_PUBLIC_VERSION_APP || 'unknown';
  const versionNginx = process.env.NEXT_PUBLIC_VERSION_NGINX || 'unknown';

  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <meta name="version-app" content={versionApp} />
        <meta name="version-nginx" content={versionNginx} />
      </head>
      <body
        className={clsx(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
        )}
      >
        <Providers themeProps={{ attribute: "class", defaultTheme: "dark" }}>
          <SessionProvider>
            <div className="relative flex flex-col h-screen">
              <main className="container mx-auto h-screen flex items-center justify-center">
                <div className="w-full max-w-md">
                  {children}
                </div>
              </main>
            </div>
          </SessionProvider>
        </Providers>
      </body>
    </html>
  );
}