"use client";

import { Button, Chip } from "@heroui/react";
import {
  CheckCircle2,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  Smartphone,
  Unplug,
  AlertTriangle,
  Radio,
} from "lucide-react";
import type { DeviceConfigPayload } from "@/types/config";
import type { DeviceHardware } from "@/types/device";
import type { RegistrationStatus } from "@/hooks/use-configure";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import { useCopy } from "@/components/CopyProvider";

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
  /** Radio auto-registration result */
  registrationStatus: RegistrationStatus;
  /** Retry radio registration after failure */
  onRetryRegistration: () => Promise<void>;
  /** Sync keys: re-read the device over USB and re-register (no re-flash) */
  onSyncKeys: () => Promise<void>;
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
export function DoneStep({ device, configPayload, registrationStatus, onRetryRegistration, onSyncKeys, onFlashAnother }: DoneStepProps) {
  const { t } = useCopy();
  const archColor = device ? (ARCH_COLORS[device.architecture] || "primary") : "primary";
  const isSyncing = registrationStatus.state === "pending";

  return (
    <div className="space-y-4">
      {/* Celebration header: glass-card with left info | right device image */}
      <div className="glass-card rounded-xl p-6 border-teal-500/30 shadow-[0_0_16px_rgba(20,184,166,0.1)]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
          {/* Left: celebration info */}
          <div className="min-w-0 flex items-center gap-3">
            <div className="animate-[scale-in_0.3s_ease-out]">
              <CheckCircle2 className="w-12 h-12 text-primary drop-shadow-[0_0_24px_rgba(20,184,166,0.4)] flex-shrink-0" />
            </div>
            <div>
              <h2 className="font-mono text-2xl text-primary">{t("flash.done.title")}</h2>
              <p className="text-sm text-default-400 mt-1">
                {t("flash.done.subtitle")}
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
            {t("flash.done.configTitle")}
          </h3>

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">{t("flash.done.longName")}</span>
            <span className="font-mono text-foreground">
              {configPayload.identity.longName}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">{t("flash.done.shortName")}</span>
            <span className="font-mono text-foreground">
              {configPayload.identity.shortName}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">{t("flash.done.mqttServer")}</span>
            <span className="font-mono text-foreground">
              {configPayload.mqtt.server}:{configPayload.mqtt.port}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          {/* The one field a runner can cross-check in the Meshtastic phone app
              (MQTT module settings) to catch a radio that kept stale creds. */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500" title={t("flash.done.mqttUserHint")}>
              {t("flash.done.mqttUser")}
            </span>
            <span className="font-mono text-foreground">
              {configPayload.mqtt.username}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">{t("flash.done.channels")}</span>
            <span className="font-mono text-foreground">
              {configPayload.channels.map((c) => c.name).join(", ")}
            </span>
          </div>
          <div className="border-t border-default-200/10" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-default-500">{t("flash.done.radio")}</span>
            <span className="font-mono text-foreground">
              {configPayload.radio.region} / {configPayload.radio.modemPreset}
            </span>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary" />
            <p className="text-sm text-default-400">
              {t("flash.done.configuredFallback")}
            </p>
          </div>
        </div>
      )}

      {/* Radio registration status */}
      {registrationStatus.state !== "idle" && (
        <div className={`glass-card rounded-xl p-4 flex items-center gap-3 ${
          registrationStatus.state === "success"
            ? "border-teal-500/30"
            : registrationStatus.state === "pending"
            ? "border-primary/30"
            : "border-warning/30"
        }`}>
          {registrationStatus.state === "pending" ? (
            <>
              <RotateCcw className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
              <div className="text-sm text-default-400">{t("flash.done.registering")}</div>
            </>
          ) : registrationStatus.state === "success" ? (
            <>
              <Radio className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="text-sm">
                <span className="text-primary font-mono">{registrationStatus.nodeId}</span>
                <span className="text-default-400">
                  {registrationStatus.updated
                    ? t("flash.done.registeredUpdated")
                    : t("flash.done.registered")}
                </span>
              </div>
            </>
          ) : registrationStatus.state === "failed" ? (
            <>
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div className="text-sm flex-1">
                <span className="text-warning">{t("flash.done.regFailedPrefix")}</span>
                <span className="text-default-400">{registrationStatus.error}</span>
                <span className="text-default-500 block mt-0.5">
                  {t("flash.done.regFailedHint")}
                </span>
              </div>
              <Button
                size="sm"
                variant="flat"
                color="warning"
                startContent={<RotateCcw className="w-3.5 h-3.5" />}
                onPress={onRetryRegistration}
                className="flex-shrink-0 font-mono"
              >
                {t("flash.configure.retry")}
              </Button>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-default-400 flex-shrink-0" />
              <div className="text-sm text-default-400">
                {t("flash.done.regSkipped", { reason: registrationStatus.reason })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Sync keys card — for an already-flashed / re-keyed device. Re-reads the
          device over USB and re-registers (no re-flash). Reflects registrationStatus
          via the shared block above (pending/success/failed). */}
      <div className="glass-card rounded-xl p-4 flex items-center gap-3">
        <RefreshCw className={`w-5 h-5 text-default-400 flex-shrink-0 ${isSyncing ? "animate-spin" : ""}`} />
        <div className="text-sm flex-1 min-w-0">
          <div className="text-foreground">{t("flash.done.syncTitle")}</div>
          <div className="text-xs text-default-500 mt-0.5">{t("flash.done.syncDesc")}</div>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="primary"
          isDisabled={isSyncing}
          startContent={<RefreshCw className="w-3.5 h-3.5" />}
          onPress={onSyncKeys}
          className="flex-shrink-0 font-mono"
        >
          {isSyncing ? t("flash.done.syncing") : t("flash.done.syncButton")}
        </Button>
      </div>

      {/* Next steps card */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-mono text-default-500 uppercase tracking-wider mb-4">
          {t("flash.done.nextTitle")}
        </h3>

        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-primary">1</span>
            </div>
            <div>
              <a
                href={`https://run.defcon.run/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}/whoami`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("flash.done.step1Link")}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <p className="text-xs text-default-500 mt-0.5">
                {t("flash.done.step1Desc")}
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-primary">2</span>
            </div>
            <div>
              <p className="text-sm text-foreground inline-flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-default-400" />
                {t("flash.done.step2")}
              </p>
              <p className="text-xs text-default-500 mt-0.5">
                {t("flash.done.step2Desc")}
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <span className="text-xs font-mono text-primary">3</span>
            </div>
            <div>
              <p className="text-sm text-foreground inline-flex items-center gap-1">
                <Unplug className="w-3.5 h-3.5 text-default-400" />
                {t("flash.done.step3")}
              </p>
              <p className="text-xs text-default-500 mt-0.5">
                {t("flash.done.step3Desc")}
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
          {t("flash.done.flashAnother")}
        </Button>
      </div>
    </div>
  );
}
