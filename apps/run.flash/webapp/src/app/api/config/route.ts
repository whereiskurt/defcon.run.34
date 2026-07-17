import { auth } from "@/config/auth";
import { meshtasticConfig, resolveRingtone } from "@/config/meshtastic";
import { NextResponse } from "next/server";
import type { DeviceConfigPayload } from "@/types/config";

const isDev = process.env.NODE_ENV !== "production";
const RUN_HUMAN_INTERNAL_URL = process.env.RUN_HUMAN_INTERNAL_URL || (isDev ? "http://localhost:3001" : "");
const AUTH_INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Fetch user profile from run.human's internal API.
 * Resolves OIDC subject → adapter userId → RunUser profile server-to-server.
 */
async function fetchRunUserProfile(oidcSub: string) {
  if (!RUN_HUMAN_INTERNAL_URL || !AUTH_INTERNAL_SECRET) {
    console.error("[run.flash] RUN_HUMAN_INTERNAL_URL or AUTH_INTERNAL_SECRET not configured");
    return null;
  }

  const url = `${RUN_HUMAN_INTERNAL_URL}/api/internal/user/${oidcSub}`;
  console.log(`[run.flash] Fetching user profile from ${url}`);

  const response = await fetch(url, {
    headers: { "x-internal-secret": AUTH_INTERNAL_SECRET },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[run.flash] run.human internal API returned ${response.status}: ${text}`);
    return null;
  }

  return response.json();
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch user profile from run.human (resolves OIDC sub → adapter userId → RunUser)
    let user = null;
    if (!isDev || RUN_HUMAN_INTERNAL_URL) {
      user = await fetchRunUserProfile(session.user.id);
    }

    // In dev without run.human, use stub config
    if (!user && isDev) {
      console.warn("[run.flash] run.human not available in dev, using stub config");
      user = { displayName: null, mqttUsername: "dev_user", mqttPassword: "dev_pass", mqttUsertype: "rabbit", ringtone: null };
    }

    // Identity: prefer RunUser.displayName, fall back to session name, then generated
    const longName =
      user?.displayName ||
      session.user.name ||
      `DCR34_${session.user.id.slice(0, 4)}`;
    const shortName = longName.slice(0, 4).toUpperCase();

    // MQTT credentials from RunUser profile
    const mqttUsername = user?.mqttUsername || "";
    const mqttPassword = user?.mqttPassword || "";

    if (!isDev && (!mqttUsername || !mqttPassword)) {
      console.warn(`[run.flash] MQTT not provisioned for user ${session.user.id}`);
      return NextResponse.json(
        { error: "User not provisioned for MQTT" },
        { status: 404 }
      );
    }

    // Ringtone: per-user override (RunUser.ringtone) or the class default keyed
    // off mqttUsertype. Never empty; clamped to the firmware length cap.
    const ringtone = resolveRingtone({
      ringtone: user?.ringtone,
      mqttUsertype: user?.mqttUsertype,
    });

    const payload: DeviceConfigPayload = {
      mqtt: {
        server: meshtasticConfig.mqtt.server,
        port: meshtasticConfig.mqtt.port,
        username: mqttUsername,
        password: mqttPassword,
        tls: meshtasticConfig.mqtt.tls,
        root: meshtasticConfig.mqtt.root,
      },
      channels: meshtasticConfig.channels,
      identity: { longName, shortName },
      radio: meshtasticConfig.radio,
      ringtone,
      position: meshtasticConfig.position,
      mapReport: meshtasticConfig.mapReport,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[run.flash] /api/config error:", error);
    return NextResponse.json(
      { error: "Failed to load configuration" },
      { status: 500 }
    );
  }
}
