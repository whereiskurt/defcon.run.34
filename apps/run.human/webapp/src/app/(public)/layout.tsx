import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { siteConfig } from "@site";
import { fontSans } from "@fonts";
import { auth } from "@/config/auth";
import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
// SessionProvider basePath - full path for client-side browser requests
// (includes Next.js basePath because browser needs the complete URL)
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
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

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
          <SessionProvider basePath={authBasePath}>
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
