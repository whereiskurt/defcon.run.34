/**
 * Meshtastic device configuration defaults.
 * Server-side only -- this file must NEVER be imported in client components.
 * Secrets (PSK, MQTT creds) come from this config + RunUser entity,
 * assembled in /api/config and served via authenticated API.
 */
import { isValidRtttl } from "@/lib/rtttl";

export const meshtasticConfig = Object.freeze({
  mqtt: {
    server: process.env.MQTT_SERVER || "mqtt.defcon.run",
    port: Number(process.env.MQTT_PORT) || 4433,
    tls: process.env.MQTT_TLS !== "false",
    // The US fleet lives on msh/US/2/e/dc.run. On our target firmware the LoRa
    // region does NOT land in the MQTT topic (and devices drop region on the
    // post-commit reboot), so relying on region=US left nodes region-less on
    // msh/2/e/dc.run — invisible to the fleet's msh/+/2/# subscription. Put the
    // region segment in the root topic directly. region=US is still pushed (for
    // LoRa operation), it just doesn't drive the topic. See runbook.
    root: process.env.MQTT_ROOT || "msh/US",
  },
  channels: [
    {
      name: "dc.run",
      psk: process.env.DCR34_PRIMARY_PSK || "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=",
      role: "PRIMARY" as const,
      // Exact GPS shared on the PSK-encrypted event channel (32 = full precision;
      // 0 = position off; ~13 = coarse grid). Only the dc.run PSK holders see it.
      positionPrecision: Number(process.env.DCR34_PRIMARY_POS_PRECISION) || 32,
    },
    // DEF CON 34 event-firmware channels. These PSKs are public constants —
    // they are baked into meshtastic/firmware event/defcon34 userPrefs.jsonc —
    // so carrying them makes defcon.run radios and b00d event radios mutually
    // audible on RF. Position precision mirrors the event build: DEFCONnect 14
    // (km-scale blur, matches event ch0), chat channels 0 (no position — the
    // keys are world-readable, exact coords don't belong there).
    {
      name: "DEFCONnect",
      psk: "OEu8wB3AItGBvza4YSHh+5a3LlW/dCJ+nWr7SNZMsaE=",
      role: "SECONDARY" as const,
      positionPrecision: 14,
    },
    {
      name: "HackerComms",
      psk: "6IzsaoVhx1ETWeWuu0dUWMLqItvYJLbRzwgTAKCfvtY=",
      role: "SECONDARY" as const,
      positionPrecision: 0,
    },
    {
      name: "NodeChat",
      psk: "TiIdi8MJG+IRnIkS8iUZXRU+MHuGtuzEasOWXp4QndU=",
      role: "SECONDARY" as const,
      positionPrecision: 0,
    },
    {
      name: "LongFast",
      psk: process.env.DCR34_BRIDGE_PSK || "AQ==",
      role: "SECONDARY" as const,
      // Position sharing OFF on the public bridge channel (uses the default key,
      // so exact coords here would be world-readable). 0 = no position packets.
      positionPrecision: Number(process.env.DCR34_BRIDGE_POS_PRECISION) || 0,
    },
  ],
  // Device config: rebroadcast only CORE portnums (text/position/nodeinfo/
  // telemetry/routing). At con density a radio relaying every exotic app port
  // burns shared airtime; core-only keeps the mesh useful for everyone.
  device: {
    rebroadcastMode: process.env.DEVICE_REBROADCAST_MODE || "CORE_PORTNUMS_ONLY",
  },
  radio: {
    // Region is HARDCODED to US and intentionally NOT env-overridable. Every
    // device is flashed on-site at DEF CON (Las Vegas), and a wrong/UNSET region
    // makes the node publish to a region-less MQTT topic (msh/2/e/dc.run) that
    // the US fleet (msh/US/2/e/dc.run) never sees. Locking it here removes any
    // chance a deploy/env misconfig picks the wrong region.
    //
    // NOTE: this does NOT by itself fix a device that DROPS the region during
    // the post-commit reboot (a firmware/flash concern) — the config push
    // already sent US correctly. Detecting that needs a post-commit read-back.
    region: "US",
    // RF settings match the official DEF CON 34 event firmware (meshtastic/firmware
    // event/defcon34: SHORT_TURBO, frequency slot 31) so defcon.run radios and
    // event-firmware radios share the same LoRa channel and can hear each other.
    modemPreset: process.env.LORA_MODEM_PRESET || "SHORT_TURBO",
    // Explicit frequency slot. 0 would let the firmware derive the slot from the
    // primary channel name ("dc.run"), which lands on a different frequency than
    // the event mesh.
    channelNum: Number(process.env.LORA_CHANNEL_NUM) || 31,
    hopLimit: Number(process.env.LORA_HOP_LIMIT) || 3,
  },
  // Device-level Position module: enable GPS + smart broadcast so the node
  // actually emits position packets. Smart broadcast sends more often while
  // moving and throttles when still; broadcastSecs is the interval cap.
  // Per-channel positionPrecision (above) decides how exact those coords are.
  position: {
    broadcastSecs: Number(process.env.POSITION_BROADCAST_SECS) || 60,
    smartEnabled: process.env.POSITION_SMART_ENABLED !== "false",
  },
  // Map reporting: force-provisioned by the flasher so the operator never has to
  // accept the in-app "share unencrypted node data via MQTT" consent gate.
  // WARNING: map reports are UNENCRYPTED and public — positionPrecision here
  // exposes location on the public map (32 = exact). Set 0 / MAP_REPORTING_ENABLED=false to withhold.
  mapReport: {
    enabled: process.env.MAP_REPORTING_ENABLED !== "false",
    positionPrecision: Number(process.env.MAP_REPORT_POS_PRECISION) || 32,
    publishIntervalSecs: Number(process.env.MAP_REPORT_INTERVAL_SECS) || 3600,
  },
});

/**
 * Ringtone (RTTTL) assignment. Precedence: per-user RunUser.ringtone (set via
 * the run.human admin console) -> class default keyed off mqttUsertype -> rabbit
 * default. The result is ALWAYS a valid, well-formed RTTTL (a class default when
 * the personal tune is missing/blank/malformed/over-length) -- never empty, and
 * never truncated mid-note. Writing a malformed/empty ringtone to a device has
 * been implicated in post-config boot failures, so we fall back rather than
 * emit anything a device can choke on.
 *
 * Placeholder tunes -- swap these strings to change the defaults (one PR).
 * Keep every RINGTONES entry a valid RTTTL within MAX_RINGTONE_LEN.
 */
export { MAX_RINGTONE_LEN } from "@/lib/rtttl";

export const RINGTONES = Object.freeze({
  rabbit: "dcrun:d=8,o=6,b=140:c,e,g,c7",
  wildhare: "hare:d=16,o=6,b=200:c,e,g,c7,g,e,c,e,g,c7",
  og: "og:d=8,o=5,b=110:g,p,g,p,e,p,c,2g",
  admin: "admin:d=8,o=5,b=100:g,g,g,4d#",
});

export function ringtoneForClass(usertype?: string | null): string {
  switch (usertype) {
    case "wildhare":
      return RINGTONES.wildhare;
    case "og":
      return RINGTONES.og;
    case "admin":
      return RINGTONES.admin;
    case "rabbit":
    default:
      return RINGTONES.rabbit;
  }
}

export function resolveRingtone(user?: {
  ringtone?: string | null;
  mqttUsertype?: string | null;
}): string {
  const personal = user?.ringtone?.trim();
  // Use the personal tune only when it is a VALID RTTTL within the length cap.
  // Otherwise fall back to the class default, which is always known-good. Never
  // slice to fit -- a truncated RTTTL can be malformed.
  if (personal && isValidRtttl(personal)) {
    return personal;
  }
  return ringtoneForClass(user?.mqttUsertype);
}
