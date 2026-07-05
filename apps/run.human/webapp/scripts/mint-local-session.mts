/**
 * LOCAL-ONLY dev bypass: mint a run.human session JWT signed with the LOCAL
 * AUTH_JWT_SECRET, so authenticated pages (/whoami, check-in modal) can be
 * exercised without running the full OIDC + email login flow.
 *
 * Only works against a dev server using the same .env secret — useless
 * against prod (its secret lives in SSM).
 *
 * Usage:
 *   cd apps/run.human/webapp && npx tsx --env-file=.env scripts/mint-local-session.mts
 * then set the printed value as the `sess_run` cookie for localhost
 * (httpOnly, path=/) and open http://localhost:3001/whoami.
 *
 * Includes the `admin` service so secret pins (gold star) show in pickers.
 */
import { encode } from "next-auth/jwt";

const secrets = process.env.AUTH_JWT_SECRET!.split(",");
const now = Date.now();

const token = await encode({
  token: {
    sub: "local-rabbit-0001",
    userId: "local-rabbit-0001",
    email: "neonrabbit@local.test",
    name: "NeonRabbit",
    displayName: "NeonRabbit",
    services: ["run", "admin"],
    linkedProviders: [],
    sessionVersion: 1,
    lastRefresh: now,
  },
  secret: secrets,
  salt: "sess_run",
  maxAge: 24 * 3600,
});

console.log(token);
