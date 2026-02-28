"use client";

import { Accordion, AccordionItem, Link } from "@heroui/react";
import { Wrench, ExternalLink } from "lucide-react";

/**
 * Expandable troubleshooting section for serial connection failures.
 * Shows generic ESP32 bootloader guidance plus link to Meshtastic docs.
 * Per CONTEXT.md: hidden by default, brief error visible, detailed steps expandable.
 */
export function BootloaderHelp() {
  return (
    <Accordion variant="bordered" className="mt-3">
      <AccordionItem
        key="troubleshooting"
        aria-label="Troubleshooting Connection Issues"
        title={
          <span className="flex items-center gap-2 text-sm font-mono text-default-400">
            <Wrench className="w-4 h-4" />
            Troubleshooting Connection Issues
          </span>
        }
      >
        <div className="terminal-block p-4 space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-2 text-default-400">
            <li>
              Make sure your device is connected via USB cable
            </li>
            <li>
              Close any other apps using the serial port (Arduino IDE, PlatformIO,
              serial monitors)
            </li>
            <li>
              Put your device in bootloader mode: Hold the{" "}
              <span className="font-mono text-default-200">BOOT</span> button,
              press and release{" "}
              <span className="font-mono text-default-200">RESET</span>, then
              release{" "}
              <span className="font-mono text-default-200">BOOT</span>
            </li>
            <li>
              If using ESP32-C3 with USB-JTAG, try a different USB port or cable
            </li>
            <li>
              Try a different USB cable &mdash; some cables are charge-only and
              don&apos;t carry data
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
              View device-specific instructions
            </Link>
          </div>
        </div>
      </AccordionItem>
    </Accordion>
  );
}
