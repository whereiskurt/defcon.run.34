"use client";

import { Button, Chip } from "@heroui/react";
import {
  CheckCircle2,
  RotateCcw,
  ExternalLink,
  Smartphone,
  Unplug,
} from "lucide-react";
import type { DeviceConfigPayload } from "@/types/config";
import type { DeviceHardware } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

interface DoneStepProps {
  /** Selected device for image display */
  device: DeviceHardware | null;
  /** Config payload from useConfigure for summary display */
  configPayload: DeviceConfigPayload | null;
  /** Reset entire wizard to pick-device step */
  onFlashAnother: () => void;
}

/**
 * Done wizard step: teal celebration, config summary, next steps,
 * and "Flash Another Device" button for booth provisioning.
 *
 * Per CONTEXT.md locked decisions:
 * - Quick celebration: brief teal glow/checkmark, then practical summary
 * - Full config summary: long name, short name, MQTT server, channels, radio
 * - No secrets shown (no PSK, no MQTT password)
 * - Next steps: register radio, download app, disconnect USB
 * - "Flash Another Device" resets wizard for provisioning multiple boards
 */
export function DoneStep({ device, configPayload, onFlashAnother }: DoneStepProps) {
  const archColor = device ? (ARCH_COLORS[device.architecture] || "primary") : "primary";

  return (
    <div className="space-y-4">
      {/* Celebration header: glass-card with left info | right device image */}
      <div className="glass-card rounded-xl p-6 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          {/* Left: celebration info */}
          <div className="min-w-0 flex items-center gap-3">
            <div className="animate-[scale-in_0.3s_ease-out]">
              <CheckCircle2 className="w-12 h-12 text-teal-400 drop-shadow-[0_0_24px_rgba(20,184,166,0.4)] flex-shrink-0" />
            </div>
            <div>
              <h2 className="font-mono text-2xl text-teal-400">Setup Complete!</h2>
              <p className="text-sm text-default-400 mt-1">
                Your device is configured and ready for the DEF CON 34 mesh network.
              </p>
            </div>
          </div>

          {/* Center: spacer */}
          <div className="flex-shrink-0" />

          {/* Right: device image */}
          {device ? (
            <div className="flex flex-col items-center gap-2 justify-self-end">
              <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getDeviceImagePath(device)}
                  alt={device.displayName}
                  className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="font-mono text-sm text-default-500">
                  {device.displayName}
                </span>
                <Chip size="sm" variant="flat" color={archColor}>
                  {getArchLabel(device)}
                </Chip>
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>

      {/* Config summary card */}
      {configPayload ? (
        <div className="glass-card rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-mono text-default-500 uppercase tracking-wider mb-4">
            Device Configuration
          </h3>

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">Long Name</span>
            <span className="font-mono text-foreground">
              {configPayload.identity.longName}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">Short Name</span>
            <span className="font-mono text-foreground">
              {configPayload.identity.shortName}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">MQTT Server</span>
            <span className="font-mono text-foreground">
              {configPayload.mqtt.server}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">Channels</span>
            <span className="font-mono text-foreground">
              {configPayload.channels.map((c) => c.name).join(", ")}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">Radio</span>
            <span className="font-mono text-foreground">
              {configPayload.radio.region} / {configPayload.radio.modemPreset}
            </span>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-teal-400" />
            <p className="text-sm text-default-400">
              Your device has been successfully configured.
            </p>
          </div>
        </div>
      )}

      {/* Next steps card */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-mono text-default-500 uppercase tracking-wider mb-4">
          Next Steps
        </h3>

        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-400/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-teal-400">1</span>
            </div>
            <div>
              <a
                href="https://run.defcon.run"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                Register your radio on run.defcon.run
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <p className="text-xs text-default-500 mt-0.5">
                Link your device to your DEF CON 34 profile
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-400/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-teal-400">2</span>
            </div>
            <div>
              <p className="text-sm text-foreground inline-flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-default-400" />
                Download the Meshtastic app to monitor your device
              </p>
              <p className="text-xs text-default-500 mt-0.5">
                Available for iOS and Android
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-400/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-teal-400">3</span>
            </div>
            <div>
              <p className="text-sm text-foreground inline-flex items-center gap-1">
                <Unplug className="w-3.5 h-3.5 text-default-400" />
                Disconnect USB &mdash; your device is ready!
              </p>
              <p className="text-xs text-default-500 mt-0.5">
                Your radio will automatically join the mesh network
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Flash Another Device button — below panels with pulse */}
      <div className="flex justify-center pt-2">
        <Button
          color="primary"
          size="lg"
          startContent={<RotateCcw className="w-5 h-5" />}
          onPress={onFlashAnother}
          className="font-mono cta-pulse"
        >
          Flash Another Device
        </Button>
      </div>
    </div>
  );
}
