"use client";

import { Card, CardBody, Button } from "@heroui/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
// Raw DOM anchors bypass HeroUIProvider's useHref/basePath — prefix explicitly.
const homeUrl = isDev ? "/" : `/${region}`;

// Auth.js error codes we can say something useful about.
const ERROR_COPY: Record<string, string> = {
  Configuration:
    "The sign-in service rejected the request. This usually clears up on a retry.",
  AccessDenied: "Sign-in was refused for this account.",
  Verification: "The sign-in link expired or was already used.",
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("error") || "";
  const detail =
    ERROR_COPY[code] || "Something went wrong while signing you in.";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardBody className="flex flex-col items-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold">Sign-in hit a snag</h1>
          <p className="text-default-600">{detail}</p>
          {code && (
            <p className="text-tiny text-default-400 font-mono">code: {code}</p>
          )}
          <Button as="a" href={homeUrl} color="primary" className="mt-2">
            Try again
          </Button>
          <p className="text-small text-default-500">
            Still stuck? Clearing this site&apos;s cookies for{" "}
            <span className="font-mono">defcon.run</span> and signing in again
            fixes almost every sign-in problem.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  );
}
