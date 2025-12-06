import type { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";
import { oidc, isSessionNotFound } from "@/config/oidc";

/**
 * OIDC Interaction Completion Route (Pages Router)
 *
 * This route is called after the user has successfully authenticated via Auth.js.
 * It completes the OIDC interaction and redirects back to the relying party.
 *
 * Flow:
 * 1. User visits /api/oidc/auth (from relying party)
 * 2. oidc-provider redirects to /login?oidc={uid}
 * 3. User authenticates via Auth.js (email OTP, Discord, GitHub)
 * 4. After Auth.js callback, user is redirected here
 * 5. We verify Auth.js session and complete the OIDC interaction
 * 6. User is redirected back to relying party with authorization code
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { uid } = req.query;

  if (!uid || typeof uid !== "string") {
    return res.redirect("/login?error=invalid_interaction");
  }

  // Get the Auth.js JWT token (works with Pages Router)
  // Note: getToken expects a different request type, so we cast it
  const token = await getToken({
    req: req as any,
    secret: process.env.AUTH_JWT_SECRET,
    cookieName: "sess_auth",
  });

  if (!token?.sub && !token?.email) {
    // Not logged in - redirect back to login with the interaction ID
    console.log("OIDC Interaction: No session, redirecting to login");
    return res.redirect(`/login?oidc=${uid}`);
  }

  try {
    // Get the OIDC interaction details
    const interactionDetails = await oidc.interactionDetails(req as any, res as any);

    if (!interactionDetails) {
      console.error("OIDC Interaction: Interaction not found for uid:", uid);
      return res.redirect("/login?error=interaction_expired");
    }

    // Determine the account ID (prefer explicit ID from sub, fall back to email)
    const accountId = (token.sub || token.email) as string;

    // Check what the interaction needs
    const { prompt } = interactionDetails;

    let result: Record<string, unknown>;

    if (prompt.name === "login") {
      // User just logged in, complete the login prompt
      result = {
        login: {
          accountId,
          remember: true,
        },
      };
    } else if (prompt.name === "consent") {
      // Handle consent (grant all requested scopes for now)
      // In a full implementation, you'd show a consent screen
      const grant = new oidc.Grant({
        accountId,
        clientId: interactionDetails.params.client_id as string,
      });

      // Grant all requested scopes
      if (interactionDetails.params.scope) {
        grant.addOIDCScope(interactionDetails.params.scope as string);
      }

      // Save the grant
      const grantId = await grant.save();

      result = {
        consent: {
          grantId,
        },
      };
    } else {
      // Unknown prompt, just do login
      result = {
        login: {
          accountId,
          remember: true,
        },
      };
    }

    // Complete the interaction and get the redirect URL
    const redirectTo = await oidc.interactionResult(
      req as any,
      res as any,
      result,
      { mergeWithLastSubmission: true }
    );

    // Redirect to continue the OIDC flow
    return res.redirect(redirectTo);
  } catch (error) {
    console.error("OIDC Interaction error:", error);

    if (isSessionNotFound(error)) {
      return res.redirect("/login?error=session_expired");
    }

    return res.redirect("/login?error=oidc_error");
  }
}
