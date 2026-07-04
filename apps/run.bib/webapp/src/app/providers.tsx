"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { HeroUIProvider } from "@heroui/react";
import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";
import SilentSSO from "@/components/SilentSSO";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
  authBasePath?: string;
}

// App is mounted at /{region} (basePath) in production. router.push (used by
// HeroUI's navigate) already prepends the basePath, so link hrefs are written
// WITHOUT it; useHref prepends it to the rendered DOM href so full navigations
// also land under /{region}/...
const basePath =
  process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";

export function Providers({ children, themeProps, authBasePath }: ProvidersProps) {
  const router = useRouter();

  return (
    <NextThemesProvider {...themeProps}>
      <HeroUIProvider
        navigate={router.push}
        useHref={(href) => (href.startsWith("/") ? `${basePath}${href}` : href)}
      >
        <SessionProvider basePath={authBasePath}>
          {/* App-wide hidden-iframe silent-SSO probe (self-gates on unauthenticated). */}
          <SilentSSO />
          {children}
        </SessionProvider>
      </HeroUIProvider>
    </NextThemesProvider>
  );
}
