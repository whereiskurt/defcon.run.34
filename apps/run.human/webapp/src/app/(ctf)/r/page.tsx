import { auth } from "@/config/auth";
import ScanClient from "./ScanClient";

/**
 * /r — runner social QR scan target.
 *
 * Reached via the q.defcon.run resolver (`q.<domain>/r/<token>` →
 * `?p=<token16>`) or a legacy stored-eqr link (`?h=<sha256>`). Lives in the
 * (ctf) group deliberately: that layout is the public chrome WITHOUT the
 * silent-SSO redirect, so an anonymous scanner sees the sign-in bounce with a
 * callback straight back here (new accounts still credit both parties).
 */
export default async function SocialScanPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; h?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();

  return (
    <ScanClient
      mode={session?.user?.id ? "scan" : "signin"}
      p={typeof params.p === "string" ? params.p : undefined}
      h={typeof params.h === "string" ? params.h : undefined}
    />
  );
}
