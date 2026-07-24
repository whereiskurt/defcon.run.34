"use client";

import { Button, Chip } from "@heroui/react";
import { Download, ArrowRight, Usb, HardDriveDownload } from "lucide-react";
import type { DeviceHardware } from "@/types/device";
import { getDeviceImagePath, getArchLabel } from "@/config/devices";
import { FIRMWARE_BASE_PATH, getUf2Filename } from "@/config/firmware";
import { FirmwareVersionSelect } from "@/components/flash/firmware-version-select";
import { useCopy } from "@/components/CopyProvider";

interface Nrf52FlashStepProps {
  device: DeviceHardware;
  /** Selected firmware version (full meshtastic version string). */
  firmwareVersion: string;
  onFirmwareVersionChange: (version: string) => void;
  /** advance() from useWizard — proceeds to the Configure step. */
  onContinue: () => void;
}

/** Seeed slug for the Card Tracker T-1000E, which uses a button+cable
 *  bootloader entry rather than a RESET button. */
const T1000E_SLUG = "TRACKER_T1000_E";

/**
 * nRF52 (T-1000E / RAK4631 …) flash step: guided UF2 drag-and-drop.
 *
 * nRF52 devices run the Adafruit UF2 bootloader, which exposes a USB
 * mass-storage volume — NOT a Web USB DFU interface and NOT a Web Serial port.
 * A browser cannot copy a file onto a mounted drive, so we can't fully
 * automate the write the way esptool does for ESP32. Instead we hand the user
 * the exact firmware and precise on-device steps, then advance to Configure
 * (which reconnects over Web Serial once the device reboots into Meshtastic).
 *
 * This replaces the earlier Web USB DFU attempt, which could not work for this
 * device class (the Adafruit bootloader has no DFU 1.1 interface).
 */
export function Nrf52FlashStep({
  device,
  firmwareVersion,
  onFirmwareVersionChange,
  onContinue,
}: Nrf52FlashStepProps) {
  const { t } = useCopy();
  const downloadName = getUf2Filename(device, firmwareVersion);
  const firmwareUrl = `${FIRMWARE_BASE_PATH}/${downloadName}`;
  const isT1000e = device.hwModelSlug === T1000E_SLUG;
  const isRp2040 = device.architecture === "rp2040";

  return (
    <div className="space-y-4">
      {/* Header: download firmware + device identity */}
      <div className="glass-card rounded-xl p-5">
        <div className="grid grid-cols-[1fr_auto] items-center gap-6">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-3">
              <HardDriveDownload className="w-5 h-5 text-primary flex-shrink-0" />
              <div>
                <h3 className="font-mono text-lg text-foreground">
                  {t("flash.nrf52.title")}
                </h3>
                <p className="text-sm text-default-400">
                  {device.displayName} flashes by copying a firmware file onto
                  the device&apos;s USB drive.
                </p>
              </div>
            </div>

            <FirmwareVersionSelect
              value={firmwareVersion}
              onChange={onFirmwareVersionChange}
            />

            <Button
              as="a"
              href={firmwareUrl}
              download={downloadName}
              color="primary"
              size="lg"
              startContent={<Download className="w-5 h-5" />}
              className="font-mono whitespace-nowrap"
            >
              {t("flash.nrf52.downloadButton")}
            </Button>

            <p className="text-xs text-default-500 font-mono">
              {downloadName}
              <span className="text-default-400">
                {" "}
                &middot; Meshtastic {firmwareVersion}
              </span>
            </p>
          </div>

          {/* Device image */}
          <div className="flex flex-col items-center gap-2 justify-self-end">
            <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getDeviceImagePath(device)}
                alt={device.displayName}
                className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
              />
            </div>
            <Chip size="sm" variant="flat" color="secondary">
              {getArchLabel(device)}
            </Chip>
          </div>
        </div>
      </div>

      {/* Step-by-step instructions */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Usb className="w-4 h-4 text-default-400" />
          <span className="text-sm font-mono text-default-400">
            On your {device.displayName}
          </span>
        </div>
        <ol className="list-decimal list-inside space-y-3 text-sm text-default-500">
          <li>
            Connect the device to <span className="font-mono text-foreground">this</span>{" "}
            computer with a data-capable USB cable.
          </li>

          {isRp2040 ? (
            <li>
              Enter bootloader mode:{" "}
              <span className="text-foreground">
                unplug the device, then hold the BOOTSEL button while
                reconnecting the USB cable
              </span>
              , and release it once connected.
            </li>
          ) : isT1000e ? (
            <li>
              Enter bootloader mode:{" "}
              <span className="text-foreground">
                press and hold the device&apos;s button, and while holding it,
                connect the USB / magnetic charge cable twice in quick
                succession
              </span>
              . The device mounts as a USB drive when it&apos;s in bootloader
              mode.
            </li>
          ) : (
            <li>
              Enter bootloader mode:{" "}
              <span className="text-foreground">double-tap the RESET button</span>{" "}
              (press RST twice, quickly). Do <span className="font-mono">not</span>{" "}
              hold BOOT.
            </li>
          )}

          <li>
            A USB drive appears in your file manager named like{" "}
            <span className="font-mono text-foreground">
              {isRp2040 ? "RPI-RP2" : isT1000e ? "T1000-E" : "FTHR840BOOT"}
            </span>{" "}
            (the UF2 bootloader).
          </li>
          <li>
            <span className="text-foreground">
              Drag the downloaded <span className="font-mono">.uf2</span> file
              onto that drive
            </span>{" "}
            (or copy-paste it in). The file copies, then the device reboots on
            its own — the drive disappears.
          </li>
          <li>
            Wait ~10–20 seconds for the device to boot into Meshtastic, then
            continue. On the next step your browser will ask which serial port
            to use — pick this device.
          </li>
        </ol>
      </div>

      {/* Continue */}
      <div className="flex justify-center">
        <Button
          color="primary"
          size="lg"
          endContent={<ArrowRight className="w-5 h-5" />}
          onPress={onContinue}
          className="font-mono whitespace-nowrap cta-pulse"
        >
          {t("flash.nrf52.continue")}
        </Button>
      </div>
    </div>
  );
}
