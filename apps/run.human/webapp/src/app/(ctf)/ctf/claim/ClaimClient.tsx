"use client";

import { Card, CardBody, Button, Chip } from "@heroui/react";
import { useEffect } from "react";
import { signIn } from "next-auth/react";
import { Trophy, Flag, ScanLine } from "lucide-react";
import type { JudgeResult } from "@/lib/ctf-judge";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
// Region-prefixed post-login redirect back to this claim page (the signed-in
// return then redeems the parked nonce). Mirrors (public)/page.tsx's whoamiUrl.
const claimUrl = isDev ? "/ctf/claim" : `/${region}/ctf/claim`;

type Mode = "result" | "signin" | "empty";

interface Props {
  mode: Mode;
  result?: JudgeResult;
  nonce?: string;
  clearNonce?: boolean;
}

/** Presentational result card + nonce cookie keeper for the visible claim page. */
export default function ClaimClient({ mode, result, nonce, clearNonce }: Props) {
  // Persist the parked nonce so the signed-in return can redeem it (mode=signin).
  useEffect(() => {
    if (mode === "signin" && nonce) {
      document.cookie = `ctf_pending=${nonce}; path=/; max-age=${60 * 60 * 24 * 30}`;
    }
  }, [mode, nonce]);

  // Clear the nonce once it has been redeemed (mode=result after a claimPending).
  useEffect(() => {
    if (clearNonce) {
      document.cookie = "ctf_pending=; path=/; max-age=0";
    }
  }, [clearNonce]);

  return (
    <div className="flex flex-col items-center py-16 animate-slide-up">
      <Card className="w-full max-w-md bg-content1 border border-default-100">
        <CardBody className="flex flex-col items-center gap-4 py-10 px-6 text-center">
          {mode === "result" && result ? (
            <ResultBody result={result} />
          ) : mode === "signin" ? (
            <>
              <Trophy className="w-10 h-10 text-primary" />
              <h2 className="font-museo text-2xl font-bold text-foreground">
                Flag captured!
              </h2>
              <p className="text-sm text-default-500 max-w-xs">
                Sign in to claim your points — we&apos;ve saved this flag for you.
              </p>
              <Button
                variant="solid"
                color="primary"
                size="lg"
                className="font-semibold px-8"
                onPress={() =>
                  signIn("run.defcon.run", { callbackUrl: claimUrl })
                }
              >
                Sign in to claim your points
              </Button>
            </>
          ) : (
            <>
              <ScanLine className="w-10 h-10 text-default-400" />
              <h2 className="font-museo text-xl font-bold text-foreground">
                Nothing to claim
              </h2>
              <p className="text-sm text-default-500 max-w-xs">
                Scan a DEF CON 34 QR code to capture a flag.
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** Maps a JudgeResult to a visible state. The judge already hides wrong-vs-disabled. */
function ResultBody({ result }: { result: JudgeResult }) {
  if (result.solved && result.points > 0) {
    return (
      <>
        <Trophy className="w-10 h-10 text-primary" />
        <h2 className="font-museo text-2xl font-bold text-foreground">
          Flag captured!
        </h2>
        {result.firstBlood && (
          <Chip color="danger" variant="flat" className="font-semibold">
            🩸 First blood
          </Chip>
        )}
        <p className="font-museo text-4xl font-bold text-primary">
          +{result.points}
        </p>
        <p className="text-sm text-default-500">
          {result.ordinal ? `Solve #${result.ordinal}` : "points scored"}
        </p>
      </>
    );
  }

  if (result.solved) {
    // capped (solved but points === 0) — celebrate, but no points remain.
    return (
      <>
        <Flag className="w-10 h-10 text-primary" />
        <h2 className="font-museo text-2xl font-bold text-foreground">
          Flag captured!
        </h2>
        <p className="text-sm text-default-500 max-w-xs">
          This one&apos;s already been claimed by enough runners — points are
          capped, but nice grab.
        </p>
      </>
    );
  }

  // !solved — graceful non-award (do NOT reveal wrong vs. disabled).
  return (
    <>
      <Flag className="w-10 h-10 text-default-400" />
      <h2 className="font-museo text-xl font-bold text-foreground">
        That flag didn&apos;t land
      </h2>
      <p className="text-sm text-default-500 max-w-xs">
        This challenge is closed or the code didn&apos;t match. Keep scanning!
      </p>
    </>
  );
}
