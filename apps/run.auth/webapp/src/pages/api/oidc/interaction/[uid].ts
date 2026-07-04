import type { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";
import { oidc, isSessionNotFound } from "@/config/oidc";

const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.REGION_SHORT || "use1";
const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
const LOCAL_RUN_PORT = process.env.LOCAL_RUN_PORT || "3001";
const loginPath = isDev ? "/login" : `/${REGION_SHORT}/login`;

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
    res.redirect(`${loginPath}?error=invalid_interaction`);
    return;
  }

  // Get the Auth.js JWT token (works with Pages Router)
  // Note: getToken expects a different request type, so we cast it
  // Secret must match the format used in auth.ts (split by comma for key rotation)
  const token = await getToken({
    req: req as any,
    secret: process.env.AUTH_JWT_SECRET?.split(","),
    cookieName: "sess_auth",
  });

  if (!token?.sub && !token?.email) {
    // Not logged in - redirect back to login with the interaction ID
    res.redirect(`${loginPath}?oidc=${uid}`);
    return;
  }

  try {
    // Get the OIDC interaction details
    const interactionDetails = await oidc.interactionDetails(req as any, res as any);

    if (!interactionDetails) {
      console.error("OIDC Interaction: Interaction not found for uid:", uid);
      res.redirect(`${loginPath}?error=interaction_expired`);
      return;
    }

    // Determine the account ID (prefer explicit ID from sub, fall back to email)
    const accountId = (token.sub || token.email) as string;

    // Check what the interaction needs
    const { prompt } = interactionDetails;

    let result: Record<string, unknown>;

    // Helper function to create and save a grant
    // A Grant is always required for the authorization_code flow to work
    const createGrant = async () => {
      const grant = new oidc.Grant({
        accountId,
        clientId: interactionDetails.params.client_id as string,
      });

      // Grant all requested scopes
      if (interactionDetails.params.scope) {
        grant.addOIDCScope(interactionDetails.params.scope as string);
      }

      // Save the grant and return the ID
      const grantId = await grant.save();
      return grantId;
    };

    if (prompt.name === "login") {
      // User just logged in, complete the login prompt
      // Note: persisting the login (remember flag below) keeps the provider _session alive
      // across browser restarts for the full 15-day Session TTL (config.oidc.ttl.session).
      // rpInitiatedLogout still clears both the provider _session and sess_auth, so logout
      // remains complete.
      //
      // IMPORTANT: We also create a Grant here because oidc-provider requires one
      // for the token exchange. Without a grant, the /token endpoint returns invalid_grant.
      const grantId = await createGrant();

      result = {
        login: {
          accountId,
          remember: true,
        },
        consent: {
          grantId,
        },
      };
    } else if (prompt.name === "consent") {
      // Handle consent (grant all requested scopes for now)
      // In a full implementation, you'd show a consent screen
      const grantId = await createGrant();

      result = {
        consent: {
          grantId,
        },
      };
    } else {
      // Unknown prompt - create grant and complete login
      const grantId = await createGrant();

      result = {
        login: {
          accountId,
          remember: true,
        },
        consent: {
          grantId,
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
    res.redirect(redirectTo);
  } catch (error) {
    console.error("OIDC Interaction error:", error);

    if (isSessionNotFound(error)) {
      // The interaction was already completed (consumed/deleted) or never existed.
      // Since the user is authenticated, the OIDC flow likely already succeeded.
      // Redirect to the main app instead of showing an error.
      const redirectUrl = isDev
        ? `http://localhost:${LOCAL_RUN_PORT}`
        : `https://run.${siteDomain}/${REGION_SHORT}`;
      res.redirect(redirectUrl);
      return;
    }

    res.redirect(`${loginPath}?error=oidc_error`);
  }
}
