"use client";

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Button,
  Spinner,
} from "@heroui/react";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Text, Heading } from "@components/text-effects/Common";

// Callback URL - don't add region prefix, next-auth handles basePath
const dashboardUrl = "/dashboard";

function LoginContent() {
  const [mounted, setMounted] = useState(false);
  const [autoLoginTriggered, setAutoLoginTriggered] = useState(false);
  const searchParams = useSearchParams();

  const autoLogin = searchParams.get("autoLogin") === "true";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-trigger sign-in when autoLogin flag is present
  useEffect(() => {
    if (autoLogin && mounted && !autoLoginTriggered) {
      setAutoLoginTriggered(true);
      console.log("[Silent SSO] Auto-login triggered, starting OIDC flow");
      signIn("run.defcon.run", { callbackUrl: dashboardUrl });
    }
  }, [autoLogin, mounted, autoLoginTriggered]);

  // Show loading spinner during auto-login
  if (autoLogin && !autoLoginTriggered) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <Card className="shadow-lg bg-content1">
            <CardBody className="flex flex-col items-center gap-4 py-8">
              <Spinner size="lg" />
              <Text variant="small" className="text-gray-500">
                Signing you in...
              </Text>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <div className="z-10 w-full max-w-md">
        <Card className="shadow-lg bg-content1">
          <CardHeader>
            <div className="flex flex-col">
              <Heading level={1}>Welcome to DEFCON.run</Heading>
              <Text
                variant="small"
                className="text-default-500"
              >
                Sign in to access your dashboard
              </Text>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="flex justify-center">
            <Button
              variant="solid"
              color="primary"
              className="text-lg font-semibold"
              onPress={() =>
                signIn("run.defcon.run", { callbackUrl: dashboardUrl })
              }
            >
              Sign In
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function PublicPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <div className="bg-white/50 dark:bg-gray-900/50 shadow-lg rounded-lg p-6">
            <p className="text-center">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return <LoginContent />;
}
