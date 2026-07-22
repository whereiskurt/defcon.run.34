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

  const headersList = await headers();
  const fullUrl = headersList.get("x-url") || headersList.get("referer") || "";
  const isAutoLoginFlow = fullUrl.includes("autoLogin=true");
  const isAutoSigninRoute = fullUrl.includes("/api/auth/auto-signin");
  // The auth error page is the recovery stop for failed OIDC flows — it must
  // never itself bounce back into auto-signin, or an auth error becomes an
  // error -> auto-signin -> OIDC error -> error redirect loop.
  const isAuthErrorRoute = fullUrl.includes("/auth/error");

  // Silent-SSO bootstrap: if the browser carries a valid auth.defcon.run session
  // (sess_auth) but this app has NOT yet minted its own run.human session, kick
  // the (invisible) OIDC flow once to establish sess_run.
  //
  // CRITICAL: gate on `!session`. The redirect MUST NOT fire when the user is
  // already authenticated here — the previous code keyed only on the sess_auth
  // cookie and ignored `session`, so every visit to `/` by a logged-in user was
  // bounced through a full OIDC round-trip (redundant latency, and — if the
  // freshly-set sess_run failed to persist, e.g. a slow-mobile cookie race — a
  // `/` -> auto-signin -> OIDC -> `/` redirect loop). Honouring `session` makes
  // authenticated users stay on `/` (matching the intended "authenticated users
  // can stay on the welcome page" behaviour) and closes the loop.
  if (!session && !isAutoLoginFlow && !isAutoSigninRoute && !isAuthErrorRoute) {
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
