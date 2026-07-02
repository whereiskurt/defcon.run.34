"use client";

import {
  Card,
  CardBody,
  Button,
  Spinner,
} from "@heroui/react";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { ChevronRight } from "lucide-react";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const whoamiUrl = isDev ? "/whoami" : `/${region}/whoami`;
const routesUrl = isDev ? "/routes" : `/${region}/routes`;

function LoginContent() {
  const [mounted, setMounted] = useState(false);
  const [autoLoginTriggered, setAutoLoginTriggered] = useState(false);
  const searchParams = useSearchParams();

  const autoLogin = searchParams.get("autoLogin") === "true";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (autoLogin && mounted && !autoLoginTriggered) {
      setAutoLoginTriggered(true);
      console.log("[Silent SSO] Auto-login triggered, starting OIDC flow");
      signIn("run.defcon.run", { callbackUrl: whoamiUrl });
    }
  }, [autoLogin, mounted, autoLoginTriggered]);

  if (autoLogin && !autoLoginTriggered) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 animate-fade-in">
        <Spinner size="lg" color="primary" />
        <p className="text-sm text-default-400 font-mono">
          Signing you in...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 py-16 animate-slide-up">
      <div className="text-center space-y-3">
        <h2 className="font-museo text-2xl font-bold text-foreground">
          Welcome to DEF CON 34
        </h2>
        <p className="text-sm text-default-500 max-w-sm">
          Sign in to access your dashboard, routes, and event features.
        </p>
      </div>
      <Button
        variant="solid"
        color="primary"
        className="font-semibold px-8"
        size="lg"
        onPress={() =>
          signIn("run.defcon.run", { callbackUrl: whoamiUrl })
        }
      >
        Sign In
      </Button>
    </div>
  );
}

function WelcomeContent({ userName }: { userName: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 animate-slide-up">
      <p className="font-museo text-2xl font-bold text-foreground text-center">
        Welcome back, {userName}
      </p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <Button
          variant="solid"
          color="primary"
          className="font-semibold w-full"
          size="lg"
          href={whoamiUrl}
          as="a"
          endContent={<ChevronRight className="w-4 h-4" />}
        >
          Who Am I
        </Button>
        <Button
          variant="flat"
          color="default"
          className="w-full"
          href={routesUrl}
          as="a"
          endContent={<ChevronRight className="w-4 h-4" />}
        >
          Routes
        </Button>
      </div>
    </div>
  );
}

export default function PublicPage() {
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || status === "loading") {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <div className="h-8 w-48 rounded bg-content2 animate-pulse" />
        <div className="h-4 w-64 rounded bg-content2 animate-pulse" />
      </div>
    );
  }

  if (session?.user) {
    const userName = session.user.displayName || session.user.name?.split(' ')[0] || 'Runner';
    return <WelcomeContent userName={userName} />;
  }

  return <LoginContent />;
}
