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
      <div className="space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
            defcon<span className="teal-dot">.</span>run
          </h1>
        </div>
        <Card className="glass-card">
          <CardBody className="flex flex-col items-center gap-4 py-10">
            <Spinner size="lg" color="primary" />
            <p className="text-sm text-default-400 font-mono">
              Signing you in...
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Wordmark */}
      <div className="text-center space-y-2">
        <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
          defcon<span className="teal-dot">.</span>run
        </h1>
        <p className="font-mono text-xs text-default-400 tracking-widest uppercase">
          DEF CON 34 &mdash; Las Vegas 2026
        </p>
      </div>

      <Card className="glass-card overflow-hidden">
        <CardBody className="flex flex-col items-center gap-4 py-8 px-6">
          <p className="text-sm text-default-500 text-center">
            Sign in to access your dashboard, routes, and event features.
          </p>
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
        </CardBody>
      </Card>
    </div>
  );
}

function WelcomeContent({ userName }: { userName: string }) {
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Wordmark */}
      <div className="text-center space-y-2">
        <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
          defcon<span className="teal-dot">.</span>run
        </h1>
        <p className="font-mono text-xs text-default-400 tracking-widest uppercase">
          DEF CON 34 &mdash; Las Vegas 2026
        </p>
      </div>

      <Card className="glass-card overflow-hidden">
        <CardBody className="flex flex-col items-center gap-5 py-8 px-6">
          <p className="font-museo text-2xl font-bold text-foreground text-center">
            Welcome back, {userName}
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <Button
              variant="solid"
              color="primary"
              className="font-semibold w-full"
              size="lg"
              href="/whoami"
              as="a"
              endContent={<ChevronRight className="w-4 h-4" />}
            >
              Who Am I
            </Button>
            <Button
              variant="flat"
              color="default"
              className="w-full"
              href="/routes"
              as="a"
              endContent={<ChevronRight className="w-4 h-4" />}
            >
              Routes
            </Button>
            <Button
              variant="flat"
              color="default"
              className="w-full"
              href="/leaderboard"
              as="a"
              endContent={<ChevronRight className="w-4 h-4" />}
            >
              Leaderboard
            </Button>
          </div>
        </CardBody>
      </Card>
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
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="h-10 w-48 mx-auto rounded bg-content2 animate-pulse" />
          <div className="h-4 w-64 mx-auto rounded bg-content2 animate-pulse" />
        </div>
        <div className="glass-card rounded-xl p-6">
          <div className="h-24 rounded bg-content2 animate-pulse" />
        </div>
      </div>
    );
  }

  if (session?.user) {
    const userName = session.user.displayName || session.user.name?.split(' ')[0] || 'Runner';
    return <WelcomeContent userName={userName} />;
  }

  return <LoginContent />;
}
