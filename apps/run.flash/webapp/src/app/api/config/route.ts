import { auth } from "@/config/auth";
import { getRunUser } from "@/entities/run-user";
import { meshtasticConfig } from "@/config/meshtastic";
import { NextResponse } from "next/server";
import type { DeviceConfigPayload } from "@/types/config";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isDev = process.env.NODE_ENV !== "production";

    // In dev without DynamoDB, skip the user lookup entirely
    let user = null;
    if (!isDev || process.env.RUN_ELECTRO_ENDPOINT) {
      try {
        user = await getRunUser(session.user.id);
      } catch (dbErr) {
        if (!isDev) throw dbErr;
        console.warn("[run.flash] DynamoDB not available in dev, using stub config");
      }
    }

    // Identity: prefer RunUser.displayName, fall back to session name, then generated
    const longName =
      user?.displayName ||
      session.user.name ||
      `DCR34_${session.user.id.slice(0, 4)}`;
    const shortName = longName.slice(0, 4).toUpperCase();

    // MQTT credentials from RunUser entity
    // In dev without DynamoDB, provide stub credentials
    const mqttUsername = user?.mqttUsername || (isDev ? "dev_user" : "");
    const mqttPassword = user?.mqttPassword || (isDev ? "dev_pass" : "");

    if (!isDev && (!mqttUsername || !mqttPassword)) {
      return NextResponse.json(
        { error: "User not provisioned for MQTT" },
        { status: 404 }
      );
    }

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
