"use client";

import { Card, CardBody, Button, Spinner } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { UserPlus, ScanLine } from "lucide-react";
import { useCopy } from "@/components/CopyProvider";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const prefix = isDev ? "" : `/${region}`;

type Mode = "scan" | "signin";

interface Props {
  mode: Mode;
  p?: string;
  h?: string;
}

type ScanState =
  | { phase: "loading" }
  | { phase: "success"; ownerName: string; remainingToday: number }
  | { phase: "error"; code: string; message: string };

/**
 * Runner social QR scan flow (DC33 port). One-shot POST guarded by a ref —
 * React strict-mode double-mounts must not double-award (the server pair-day
 * gate would eat the dupe anyway, but the second reply would read as an
 * error).
 */
export default function ScanClient({ mode, p, h }: Props) {
  const { t } = useCopy();
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };

  const [state, setState] = useState<ScanState>({ phase: "loading" });
  const attemptRef = useRef(false);

  // Signed-out: bounce through signin with a callback straight back here.
  const backHere = `${prefix}/r?${p ? `p=${encodeURIComponent(p)}` : `h=${encodeURIComponent(h ?? "")}`}`;
  useEffect(() => {
    if (mode !== "signin" || attemptRef.current) return;
    attemptRef.current = true;
    signIn("run.defcon.run", { callbackUrl: backHere });
  }, [mode, backHere]);

  // Signed-in: fire the scan exactly once.
  useEffect(() => {
    if (mode !== "scan" || attemptRef.current) return;
    attemptRef.current = true;
    (async () => {
      try {
        const res = await fetch(`${prefix}/api/social-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ p, h }),
        });
        const json = await res.json();
        if (res.ok) {
          setState({
            phase: "success",
            ownerName: json.ownerName,
            remainingToday: json.remainingToday,
          });
        } else {
          setState({
            phase: "error",
            code: json.code ?? "unknown",
            message: json.message ?? "Something went wrong.",
          });
        }
      } catch {
        setState({
          phase: "error",
          code: "network",
          message: "Network hiccup - try scanning again.",
        });
      }
    })();
  }, [mode, p, h]);

  return (
    <div className="flex flex-col items-center py-16 animate-slide-up">
      <Card className="w-full max-w-md bg-content1 border border-default-100">
        <CardBody className="flex flex-col items-center gap-4 py-10 px-6 text-center">
          {mode === "signin" ? (
            <>
              <UserPlus className="w-10 h-10 text-primary" />
              <h2 className="font-museo text-2xl font-bold text-foreground">
                {copyOr("socialqr.signin.title", "Rabbit spotted! 🐰")}
              </h2>
              <p className="text-sm text-default-500 max-w-xs">
                {copyOr(
                  "socialqr.signin.body",
                  "Sign in to connect - you both score a point."
                )}
              </p>
              <Button
                variant="solid"
                color="primary"
                size="lg"
                className="font-semibold px-8"
                onPress={() => signIn("run.defcon.run", { callbackUrl: backHere })}
              >
                {copyOr("socialqr.signin.button", "Sign in to connect")}
              </Button>
            </>
          ) : state.phase === "loading" ? (
            <>
              <Spinner color="primary" />
              <p className="text-sm text-default-500">
                {copyOr("socialqr.loading", "Connecting…")}
              </p>
            </>
          ) : state.phase === "success" ? (
            <>
              <p className="text-4xl leading-none">🐰🤝🐰</p>
              <h2 className="font-museo text-2xl font-bold text-foreground">
                {copyOr("socialqr.success.title", "Connected with")}{" "}
                {state.ownerName}!
              </h2>
              <p className="font-museo text-xl font-bold text-primary">
                {copyOr("socialqr.success.points", "+1 point each")}
              </p>
              <p className="text-xs text-default-500">
                {state.remainingToday}{" "}
                {copyOr("socialqr.success.remaining", "connections left today")}
              </p>
              <Button
                as={Link}
                href={`${prefix}/whoami`}
                variant="flat"
                color="primary"
                className="font-semibold"
              >
                {copyOr("socialqr.success.whoami", "Watch your QR level up")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-4xl leading-none">
                {state.code === "self"
                  ? "🐰❌🐰"
                  : state.code === "cap"
                    ? "🚫"
                    : "🐇"}
              </p>
              <h2 className="font-museo text-xl font-bold text-foreground">
                {state.code === "self"
                  ? copyOr("socialqr.error.self", "That's your own QR code!")
                  : state.code === "already_today"
                    ? copyOr(
                        "socialqr.error.already",
                        "Already connected today"
                      )
                    : state.code === "cap"
                      ? copyOr(
                          "socialqr.error.cap",
                          "Daily connection limit reached"
                        )
                      : copyOr("socialqr.error.generic", "No connection made")}
              </h2>
              <p className="text-sm text-default-500 max-w-xs">
                {state.code === "already_today"
                  ? copyOr(
                      "socialqr.error.already.body",
                      "Find new rabbits to connect with! Same pair can reconnect tomorrow."
                    )
                  : state.message}
              </p>
              <div className="flex items-center gap-1 text-xs text-default-400">
                <ScanLine className="w-4 h-4" />
                {copyOr("socialqr.error.hint", "Scan another runner's QR to score")}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
