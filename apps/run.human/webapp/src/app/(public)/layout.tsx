import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { siteConfig } from "@site";
import { fontSans, fontMono, fontMuseo, fontAtkinson } from "@fonts";
import { auth } from "@/config/auth";
import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { cookies, headers } from "next/headers";
import { Header } from "@header";
import { Footer } from "@/components/footer";
import { MapBackground } from "@/components/map-background";
import { CopyProvider } from "@/components/CopyProvider";
import { loadCopy } from "@/lib/copy";
import { config } from "@/config";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const authBasePath = isDev ? "/api/auth" : `/${REGION_SHORT}/api/auth`;

async function hasAuthSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const sessAuthCookie = cookieStore.get("sess_auth");

    if (!sessAuthCookie?.value) {
      console.log("[Silent SSO] No sess_auth cookie found");
      return false;
    }

    console.log("[Silent SSO] Found sess_auth cookie, validating with auth server...");

    const authServerUrl = config.urls.privateAuthServer;
    const response = await fetch(`${authServerUrl}/api/session/validate/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
      body: JSON.stringify({ token: sessAuthCookie.value }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.log("[Silent SSO] Token validation failed:", response.status);
      return false;
    }

    const result = await response.json();
    console.log("[Silent SSO] Token validation result:", result.valid);
    return result.valid === true;
  } catch (error) {
    console.error("[Silent SSO] Error checking auth session:", error);
    return false;
  }
}

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

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Authenticated users can stay on / (welcome page) — no redirect needed

  const headersList = await headers();
  const fullUrl = headersList.get("x-url") || headersList.get("referer") || "";
  const isAutoLoginFlow = fullUrl.includes("autoLogin=true");
  const isAutoSigninRoute = fullUrl.includes("/api/auth/auto-signin");

  if (!isAutoLoginFlow && !isAutoSigninRoute) {
    const hasAuth = await hasAuthSession();
    if (hasAuth) {
      console.log("[Silent SSO] Valid auth session found, redirecting to OIDC flow");
      const callbackUrl = encodeURIComponent(isDev ? '/whoami' : `/${REGION_SHORT}/whoami`);
      redirect(`/api/auth/auto-signin?callbackUrl=${callbackUrl}`);
    }
  }

  // Phase 39 copy toolkit: resolve the merged copy map ONCE server-side and hand
  // ONLY the resolved map to the client CopyProvider (token/URL stay server-side).
  // run.human has NO root layout, so both group layouts mount it. Resolved after
  // the silent-SSO redirect so a redirecting request skips the copy fetch.
  const copy = await loadCopy("default");

  const versionApp = process.env.NEXT_PUBLIC_VERSION_APP || "unknown";
  const versionNginx = process.env.NEXT_PUBLIC_VERSION_NGINX || "unknown";
  const APP_VERSION_TOOLTIP = `DC34 ${versionApp}`;

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
