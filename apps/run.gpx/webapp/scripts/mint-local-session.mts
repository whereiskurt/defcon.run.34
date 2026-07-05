/** LOCAL-ONLY: mint a dev sess_gpx JWT (see run.human scripts/mint-local-session.mts). */
import { encode } from "next-auth/jwt";
const token = await encode({
  token: {
    sub: "local-rabbit-0001",
    userId: "local-rabbit-0001",
    email: "neonrabbit@local.test",
    name: "NeonRabbit",
    services: ["run", "gpxstudio", "admin"],
    sessionVersion: 1,
    lastRefresh: Date.now(),
  },
  secret: process.env.AUTH_JWT_SECRET!.split(","),
  salt: "sess_gpx",
  maxAge: 24 * 3600,
});
console.log(token);
