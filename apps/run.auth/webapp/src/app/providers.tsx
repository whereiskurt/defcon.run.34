"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { HeroUIProvider } from "@heroui/system";

import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

declare module "@react-types/shared" {
  interface RouterConfig {
    routerOptions: NonNullable<
      Parameters<ReturnType<typeof useRouter>["push"]>[1]
    >;
  }
}


// App is mounted at /{region} (basePath) in production. router.push (HeroUI's
// navigate) already prepends the basePath, so internal hrefs are written
// WITHOUT it; useHref prepends the basePath to the rendered DOM href so
// new-tab / full-navigation also lands on /{region}/...
const basePath =
  process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";

export function Providers({ children, themeProps }: ProvidersProps) {
  const router = useRouter();

  return (
    <HeroUIProvider
      navigate={router.push}
      useHref={(href) => (href.startsWith("/") ? `${basePath}${href}` : href)}
    >
      <NextThemesProvider {...themeProps}>{children}</NextThemesProvider>
    </HeroUIProvider>
  );
}
