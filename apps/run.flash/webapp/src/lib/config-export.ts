/**
 * Serialize the /api/config DeviceConfigPayload into downloadable formats for
 * MANUAL radio setup — for folks who can't (iPhone/no-WebSerial) or won't use
 * the web flasher. Pure functions except downloadConfig (browser-only).
 *
 * The values here are exactly what the flasher pushes over serial; if the
 * config pipeline gains a stage, add its values to all three serializers.
 */
import type { DeviceConfigPayload, ChannelConfig } from "@/types/config";

export type ExportFormat = "txt" | "json" | "sh";

const PRIVACY =
  "KEEP THIS FILE PRIVATE — it contains your personal MQTT password and channel keys.";

export function toReadableText(p: DeviceConfigPayload): string {
  const ch = (c: ChannelConfig, i: number) =>
    [
      `  Channel ${i} (${c.role}):`,
      `    Name: ${c.name}`,
      `    PSK (base64): ${c.psk}`,
      `    Position precision: ${c.positionPrecision ?? 0} (32=exact, 0=off)`,
    ].join("\n");
  return [
    `DEF CON run — Meshtastic manual setup`,
    PRIVACY,
    ``,
    `== MQTT (app: Settings → Module Configuration → MQTT) ==`,
    `  Server address: ${p.mqtt.server}:${p.mqtt.port}`,
    `  Username: ${p.mqtt.username}`,
    `  Password: ${p.mqtt.password}`,
    `  TLS: ${p.mqtt.tls ? "on" : "off"}`,
    `  Root topic: ${p.mqtt.root}`,
    `  Enabled: on   Proxy to client enabled: on`,
    ``,
    `== Channels (app: Settings → Radio Configuration → Channels) ==`,
    ...p.channels.map(ch),
    ``,
    `== LoRa (app: Settings → Radio Configuration → LoRa) ==`,
    `  Region: ${p.radio.region}`,
    `  Modem preset: ${p.radio.modemPreset}`,
    `  Hop limit: ${p.radio.hopLimit}`,
    ``,
    `== User (app: Settings → Radio Configuration → User) ==`,
    `  Long name: ${p.identity.longName}`,
    `  Short name: ${p.identity.shortName}`,
    ``,
    `== Ringtone (app: Module Configuration → External Notification) ==`,
    `  RTTTL: ${p.ringtone}`,
    ``,
    `== Position (app: Radio Configuration → Position) ==`,
    `  Broadcast interval (s): ${p.position.broadcastSecs}`,
    `  Smart position: ${p.position.smartEnabled ? "on" : "off"}`,
    ``,
    `== Map report (app: Module Configuration → MQTT → Map reporting) ==`,
    `  Enabled: ${p.mapReport.enabled ? "on" : "off"}`,
    `  Precision: ${p.mapReport.positionPrecision}`,
    `  Publish interval (s): ${p.mapReport.publishIntervalSecs}`,
    ``,
  ].join("\n");
}

export function toJson(p: DeviceConfigPayload): string {
  return JSON.stringify(p, null, 2);
}

export function toCliScript(p: DeviceConfigPayload): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    `#!/bin/sh`,
    `# DEF CON run — Meshtastic manual setup via the Python CLI (pip install meshtastic)`,
    `# ${PRIVACY}`,
    `# Run with the radio connected over USB. Firmware 2.5+ setting names.`,
    ``,
    `meshtastic --set mqtt.address ${q(`${p.mqtt.server}:${p.mqtt.port}`)} \\`,
    `  --set mqtt.username ${q(p.mqtt.username)} --set mqtt.password ${q(p.mqtt.password)} \\`,
    `  --set mqtt.tls_enabled ${p.mqtt.tls} --set mqtt.root ${q(p.mqtt.root)} \\`,
    `  --set mqtt.enabled true --set mqtt.proxy_to_client_enabled true \\`,
    `  --set mqtt.map_reporting_enabled ${p.mapReport.enabled}`,
    ``,
    `meshtastic --set lora.region ${p.radio.region} --set lora.modem_preset ${p.radio.modemPreset} --set lora.hop_limit ${p.radio.hopLimit}`,
    `meshtastic --set position.position_broadcast_secs ${p.position.broadcastSecs} --set position.position_broadcast_smart_enabled ${p.position.smartEnabled}`,
    `meshtastic --set-owner ${q(p.identity.longName)} --set-owner-short ${q(p.identity.shortName)}`,
    `meshtastic --set-ringtone ${q(p.ringtone)}`,
    ``,
  ];
  p.channels.forEach((c, i) => {
    if (i > 0) lines.push(`meshtastic --ch-add ${q(c.name)}`);
    lines.push(
      `meshtastic --ch-set name ${q(c.name)} --ch-set psk ${q(`base64:${c.psk}`)} --ch-index ${i}`,
      `meshtastic --ch-set module_settings.position_precision ${c.positionPrecision ?? 0} --ch-index ${i}`,
    );
  });
  return lines.join("\n") + "\n";
}

const FORMATS: Record<
  ExportFormat,
  { ext: string; mime: string; render: (p: DeviceConfigPayload) => string }
> = {
  txt: { ext: "txt", mime: "text/plain", render: toReadableText },
  json: { ext: "json", mime: "application/json", render: toJson },
  sh: { ext: "sh", mime: "text/x-shellscript", render: toCliScript },
};

export function exportConfig(p: DeviceConfigPayload, f: ExportFormat) {
  const { ext, mime, render } = FORMATS[f];
  return { filename: `dcrun-radio-config.${ext}`, mime, content: render(p) };
}

export function downloadConfig(p: DeviceConfigPayload, f: ExportFormat): void {
  const { filename, mime, content } = exportConfig(p, f);
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
