import { signIn } from "@auth";
import { AuthError } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

const inviteCodes = process.env.AUTH_INVITE_CODES?.split(",");
import { cookies } from "next/headers";
import crypto from "crypto";

//This function may not be necessary but does work as describe. Next.js handles CSRF tokens automatically, apparently.
export const verifyCsrfToken = async (csrf: string): Promise<boolean> => {
  try {
    const cookie = (await cookies()).get("csrf");
    if (!cookie || !cookie.value || cookie.value.length < 1) {
      throw new Error("1. Invalid CSRF token - not found");
    }

    const csrfCookie = cookie.value;
    const delim = csrfCookie.indexOf("|") !== -1 ? "|" : "%7C"; //TODO: Remember why I did this...

    const [csrfToken, requestHash] = csrfCookie.split(delim);

    if (csrfToken !== csrf || !requestHash) {
      throw new Error("2. Mismatch token or no hash");
    }

    const secrets = (process.env.AUTH_JWT_SECRET || "").split(",");
    for (const secret of secrets) {
      if (!secret) continue;

      const expectedHash = crypto
        .createHash("sha256")
        .update(`${csrfToken}${secret}`)
        .digest("hex");

      if (expectedHash === requestHash) {
        return true;
      }
    }
  } catch (err) {
    console.error("Caught: CSRF verification error: ", err);
  }

  return false;
};

export async function POST(req: NextRequest) {
  const data = await req.json();

  const { email, csrfToken, inviteCode } = data;

  // Validate CSRF token here (optional if NextAuth.js already handles it)
  if (!verifyCsrfToken(csrfToken)) {
    return NextResponse.json(
      { message: "Invalid CSRF submission." },
      { status: 403 }
    );
  }

  if (inviteCodes?.length! > 0 && !inviteCodes?.includes(inviteCode)) {
    return NextResponse.json(
      { error: `Invalid invite code: '${inviteCode}'` },
      { status: 403 }
    );
  }

  try {
    await signIn("nodemailer", {
      email: encodeURI(email),
      csrfToken,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "Not authorized to login." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: JSON.stringify(error) }, { status: 400 });
  }
  return NextResponse.json(
    { message: "Success. Check your email." },
    { status: 200 }
  );
}
