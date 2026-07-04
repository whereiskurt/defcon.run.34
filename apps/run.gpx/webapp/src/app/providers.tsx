"use client";

import { SessionProvider } from "next-auth/react";
import SilentSSO from "@/components/SilentSSO";

interface ProvidersProps {
  children: React.ReactNode;
  authBasePath?: string;
}

export function Providers({ children, authBasePath }: ProvidersProps) {
  return (
    <SessionProvider basePath={authBasePath}>
      {/* App-wide hidden-iframe silent-SSO probe (self-gates on unauthenticated). */}
      <SilentSSO />
      {children}
    </SessionProvider>
  );
}
