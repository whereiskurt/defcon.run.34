"use client";

import { Accordion, AccordionItem, Link } from "@heroui/react";
import { Wrench, ExternalLink } from "lucide-react";

/**
 * Expandable troubleshooting section for serial connection failures.
 *
 * Per Phase 19-02 (BRND-02):
 * - Intro copy is scoped to "the flasher couldn't open serial" — not generic help.
 * - Step 3 notes that current-gen ESP32-S3/C3/C6 boards auto-enter bootloader
 *   on connect, so manual BOOT/RESET is only needed as a fallback.
 * - Outbound link kept at the current Meshtastic flashing docs URL.
 * - Kept hidden by default (Accordion) per CONTEXT.md.
 */
export function BootloaderHelp() {
  return (
    <Accordion variant="bordered" className="mt-3">
      <AccordionItem
        key="troubleshooting"
        aria-label="Serial connect troubleshooting"
        title={
          <span className="flex items-center gap-2 text-sm font-mono text-default-400">
            <Wrench className="w-4 h-4" />
            Serial connect failed? Try these
          </span>
        }
      >
        <div className="terminal-block p-4 space-y-3 text-sm">
          <p className="text-default-400">
            The browser couldn&apos;t open a serial link to your device. Work
            through the steps below in order &mdash; most connect failures fall
            out at step 1 or 2.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-default-400">
            <li>
              Confirm the device is plugged into <span className="font-mono text-default-200">this</span>{" "}
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
              <span className="font-mono text-default-200">BOOT</span>, tap{" "}
              <span className="font-mono text-default-200">RESET</span>, then
              release <span className="font-mono text-default-200">BOOT</span>,
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
      </AccordionItem>
    </Accordion>
  );
}
