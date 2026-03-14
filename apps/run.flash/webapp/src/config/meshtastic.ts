/**
 * Meshtastic device configuration defaults.
 * Server-side only -- this file must NEVER be imported in client components.
 * Secrets (PSK, MQTT creds) come from this config + RunUser entity,
 * assembled in /api/config and served via authenticated API.
 */

export const meshtasticConfig = Object.freeze({
  mqtt: {
    server: process.env.MQTT_SERVER || "mqtt.defcon.run",
    port: Number(process.env.MQTT_PORT) || 4433,
    tls: process.env.MQTT_TLS !== "false",
    root: process.env.MQTT_ROOT || "msh",
  },
  channels: [
    {
      name: "dc.run",
      psk: process.env.DCR34_PRIMARY_PSK || "Wjt8kzHci9lqdS4tBzSF2VbQd86u6U3nhHaBl7V5TGE=",
      role: "PRIMARY" as const,
    },
    {
      name: "LongFast",
      psk: process.env.DCR34_BRIDGE_PSK || "AQ==",
      role: "SECONDARY" as const,
    },
  ],
  radio: {
    region: process.env.LORA_REGION || "US",
    modemPreset: process.env.LORA_MODEM_PRESET || "LONG_FAST",
    hopLimit: Number(process.env.LORA_HOP_LIMIT) || 3,
  },
});
