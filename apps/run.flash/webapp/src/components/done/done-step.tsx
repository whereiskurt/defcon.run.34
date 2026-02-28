"use client";

import { Button } from "@heroui/react";
import {
  CheckCircle2,
  RotateCcw,
  ExternalLink,
  Smartphone,
  Unplug,
} from "lucide-react";
import type { DeviceConfigPayload } from "@/types/config";

interface DoneStepProps {
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
export function DoneStep({ configPayload, onFlashAnother }: DoneStepProps) {
  return (
    <div className="space-y-4">
      {/* Celebration header */}
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="animate-[scale-in_0.3s_ease-out]">
          <CheckCircle2 className="w-16 h-16 text-teal-400 drop-shadow-[0_0_24px_rgba(20,184,166,0.4)]" />
        </div>
        <h2 className="font-mono text-2xl text-teal-400">Setup Complete!</h2>
        <p className="text-sm text-default-400 text-center max-w-md">
          Your device is configured and ready for the DEF CON 34 mesh network.
        </p>
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

      {/* Flash Another Device button */}
      <div className="flex justify-center pt-2">
        <Button
          color="primary"
          size="lg"
          startContent={<RotateCcw className="w-5 h-5" />}
          onPress={onFlashAnother}
          className="font-mono"
        >
          Flash Another Device
        </Button>
      </div>
    </div>
  );
}
