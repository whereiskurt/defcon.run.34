import { silentHandlers } from "@/config/auth";

// Handler mount for the isolated silent-SSO Auth.js instance. Its transaction
// cookies (state/pkce/nonce/callback) are namespaced (…_silent) so the
// prompt=none iframe probe can never clobber the interactive /api/auth flow.
// See apps/run.flash/webapp/src/config/auth.ts.
export const { GET, POST } = silentHandlers;
