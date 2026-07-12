import "@/styles/globals.css";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { fontSans, fontMono, fontMuseo, fontAtkinson } from "@fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify — run.auth",
};

/**
 * Root layout for the /challenge segment.
 *
 * run.auth has NO root app/layout.tsx — the styled root (globals.css + fonts +
 * HeroUI/theme Providers) lives in (authlogin)/layout.tsx and applies ONLY to
 * that route group. /challenge sits outside it (deliberately — the visitor
 * here is already authenticated mid-OIDC-interaction, and the (authlogin)
 * group's login page contains "already signed in" redirect logic that would
 * bounce this flow), so this file is /challenge's own root layout: it MUST
 * import the global stylesheet and wrap in Providers, or the page renders
 * with zero Tailwind/HeroUI (the "unstyled page" bug hit by /admin).
 *
 * Mirrors src/app/admin/layout.tsx structure exactly.
 */
export default function ChallengeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <body
        className={clsx(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
          fontMono.variable,
          fontMuseo.variable,
          fontAtkinson.variable,
        )}
      >
        <Providers themeProps={{ attribute: "class", defaultTheme: "dark" }}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
