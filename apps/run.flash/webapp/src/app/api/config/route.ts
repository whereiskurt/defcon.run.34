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
        console.log(`[run.flash] Looking up user ${session.user.id} in DynamoDB table=${process.env.RUN_ELECTRO_DBNAME} region=${process.env.RUN_DYNAMODB_REGION}`);
        user = await getRunUser(session.user.id);
        console.log(`[run.flash] User lookup result: found=${!!user}, keys=${user ? Object.keys(user).join(',') : 'null'}, mqttUsername=${user?.mqttUsername ? 'set' : 'empty'}, mqttPassword=${user?.mqttPassword ? 'set' : 'empty'}`);
      } catch (dbErr) {
        console.error("[run.flash] DynamoDB lookup failed:", dbErr);
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
      console.warn(`[run.flash] MQTT not provisioned for user ${session.user.id}: mqttUsername=${mqttUsername ? 'set' : 'empty'}, mqttPassword=${mqttPassword ? 'set' : 'empty'}`);
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
