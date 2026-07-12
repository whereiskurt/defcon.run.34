import "@/styles/globals.css";
import clsx from "clsx";
import { Providers } from "@/app/providers";
import { fontSans, fontMono, fontMuseo, fontAtkinson } from "@fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Root layout for the /admin segment.
 *
 * run.auth has NO root app/layout.tsx — the styled root (globals.css + fonts +
 * HeroUI/theme Providers) lives in (authlogin)/layout.tsx and applies ONLY to
 * that route group. `/admin` sits outside it, so this file is /admin's own root
 * layout: it MUST import the global stylesheet and wrap in Providers, or the
 * console renders with zero Tailwind/HeroUI (the "unstyled page" bug).
 *
 * Deliberately does NOT reuse the (authlogin) chrome (Header/Footer/MapBackground
 * + the narrow max-w-md container) — the admin console is a full-width page and
 * renders its own <main>.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
