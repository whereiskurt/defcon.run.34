"use client";

import { Accordion, AccordionItem, Link } from "@heroui/react";
import { Wrench, ExternalLink } from "lucide-react";
import type { DeviceFamily } from "@/types/device";

interface BootloaderHelpProps {
  /** Device family — selects between ESP32 (serial/BOOT+RST) and nRF52
   *  (Adafruit UF2 double-tap RST) troubleshooting copy. Defaults to
   *  "esp32" so pre-family callers stay byte-identical. */
  family?: DeviceFamily;
}

/**
 * Expandable troubleshooting section for connect failures.
 *
 * Per Phase 19-02 (BRND-02) and Phase 25 (Plan 25-02-01):
 * - ESP32 branch: intro copy is scoped to "the flasher couldn't open serial";
 *   step 3 notes that current-gen ESP32-S3/C3/C6 boards auto-enter bootloader
 *   on connect, so manual BOOT/RESET is only needed as a fallback.
 * - nRF52 branch: covers double-tap RESET (Adafruit UF2 bootloader on
 *   T-1000E), enumeration hints (mass-storage volume + DFU class device),
 *   and cable/port fallbacks.
 * - Outbound link is family-aware — Meshtastic device flashing docs for
 *   ESP32, the nRF52 flashing docs for nRF52.
 * - Kept hidden by default (Accordion) per CONTEXT.md.
 */
export function BootloaderHelp({ family = "esp32" }: BootloaderHelpProps) {
  return (
    <Accordion variant="bordered" className="mt-3">
      <AccordionItem
        key="troubleshooting"
        aria-label={
          family === "nrf52"
            ? "DFU connect troubleshooting"
            : "Serial connect troubleshooting"
        }
        title={
          <span className="flex items-center gap-2 text-sm font-mono text-default-400">
            <Wrench className="w-4 h-4" />
            {family === "nrf52"
              ? "DFU connect failed? Try these"
              : "Serial connect failed? Try these"}
          </span>
        }
      >
        {family === "nrf52" ? <Nrf52HelpBody /> : <Esp32HelpBody />}
      </AccordionItem>
    </Accordion>
  );
}

// ---- ESP32 body (byte-identical to pre-Phase-25 copy) ---------------------

function Esp32HelpBody() {
  return (
    <div className="terminal-block p-4 space-y-3 text-sm">
      <p className="text-default-400">
        The browser couldn&apos;t open a serial link to your device. Work
        through the steps below in order &mdash; most connect failures fall
        out at step 1 or 2.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-default-400">
        <li>
          Confirm the device is plugged into <span className="font-mono text-foreground">this</span>{" "}
          computer with a data-capable USB cable (charge-only cables are a
          common cause &mdash; they enumerate power but not serial).
        </li>
        <li>
          Close any other program holding the serial port &mdash; Arduino
          IDE, PlatformIO, the Meshtastic CLI, or another browser tab
          running the flasher.
        </li>
        <li>
          Most current-generation ESP32-S3 / C3 / C6 boards auto-enter
          bootloader mode on connect, so you should not need to press BOOT
          first. Try Connect once; only fall through to manual bootloader
          (step 4) if the chip doesn&apos;t respond.
        </li>
        <li>
          Manual bootloader mode (fallback): hold{" "}
          <span className="font-mono text-foreground">BOOT</span>, tap{" "}
          <span className="font-mono text-foreground">RESET</span>, then
          release <span className="font-mono text-foreground">BOOT</span>,
          then click Connect.
        </li>
        <li>
          ESP32-C3 with USB-JTAG: swap to a different USB port or bypass
          hubs &mdash; some hubs strip the JTAG interface.
        </li>
        <li>
          Still stuck? Try a different data USB cable and a different port
          on your computer.
        </li>
      </ol>
      <div className="pt-2 border-t border-default-200/20">
        <Link
          href="https://meshtastic.org/docs/getting-started/flashing-firmware/"
          isExternal
          showAnchorIcon
          anchorIcon={<ExternalLink className="w-3 h-3 ml-1" />}
          className="text-sm text-primary"
        >
          Meshtastic device-specific flashing docs
        </Link>
      </div>
    </div>
  );
}

// ---- nRF52 body (Plan 25-02-01) -------------------------------------------

function Nrf52HelpBody() {
  return (
    <div className="terminal-block p-4 space-y-3 text-sm">
      <p className="text-default-400">
        The browser couldn&apos;t claim the DFU interface on your device.
        Unlike ESP32, nRF52 devices (T-1000E / RAK4631) reach the bootloader
        via a hardware button sequence &mdash; not by an auto-reset on
        connect. Work through the steps below in order.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-default-400">
        <li>
          Confirm the device is plugged into <span className="font-mono text-foreground">this</span>{" "}
          computer with a data-capable USB cable (charge-only cables enumerate
          power but not USB data &mdash; DFU can&apos;t claim them).
        </li>
        <li>
          Close any other program that might hold the USB device &mdash;
          nrfutil, uf2conv, the Meshtastic web flasher in another tab, or a
          previous flasher session that didn&apos;t clean up.
        </li>
        <li>
          Put the device in bootloader mode:{" "}
          <span className="font-mono text-foreground">double-tap RESET</span>
          {" "}(press RST twice in quick succession). Do{" "}
          <span className="font-mono text-foreground">not</span> hold BOOT
          &mdash; the T-1000E uses the Adafruit UF2 bootloader, which
          triggers on the double-tap only.
        </li>
        <li>
          After the double-tap, confirm the device enumerates in TWO ways
          before clicking Connect:
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>
              A mass-storage volume appears (Finder / File Explorer / mount
              point) with a name like{" "}
              <span className="font-mono text-foreground">
                T1000-E
              </span>{" "}
              or{" "}
              <span className="font-mono text-foreground">
                FTHR840BOOT
              </span>{" "}
              (Adafruit UF2 bootloader).
            </li>
            <li>
              A DFU-class USB device is visible to the browser (the picker
              lists it when you click Connect).
            </li>
          </ul>
        </li>
        <li>
          Still stuck? Try a different data USB cable, a different port on
          your computer (avoid unpowered hubs), or briefly disconnect and
          reconnect the device before the double-tap.
        </li>
      </ol>
      <div className="pt-2 border-t border-default-200/20">
        <Link
          href="https://meshtastic.org/docs/getting-started/flashing-firmware/nrf52/"
          isExternal
          showAnchorIcon
          anchorIcon={<ExternalLink className="w-3 h-3 ml-1" />}
          className="text-sm text-primary"
        >
          Meshtastic nRF52 flashing docs
        </Link>
      </div>
    </div>
  );
}
