"use client";

import { Accordion, AccordionItem, Link } from "@heroui/react";
import { Wrench, ExternalLink } from "lucide-react";
import type { DeviceFamily } from "@/types/device";
import { useCopy } from "@/components/CopyProvider";
import { renderMono } from "@/lib/copy-mono";

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
 *
 * Copy is sourced from the CMS catalog (`flash.help.*`). Inline hardware terms
 * (BOOT / RESET / "this" / device names) are `{token}` placeholders rendered
 * back into `font-mono text-foreground` spans via renderMono, preserving the
 * #722 readability styling while keeping the sentences editor-editable.
 */
export function BootloaderHelp({ family = "esp32" }: BootloaderHelpProps) {
  const { t } = useCopy();
  return (
    <Accordion variant="bordered" className="mt-3">
      <AccordionItem
        key="troubleshooting"
        aria-label={
          family === "nrf52"
            ? t("flash.help.nrf52.aria")
            : t("flash.help.esp32.aria")
        }
        title={
          <span className="flex items-center gap-2 text-sm font-mono text-default-400">
            <Wrench className="w-4 h-4" />
            {family === "nrf52"
              ? t("flash.help.nrf52.title")
              : t("flash.help.esp32.title")}
          </span>
        }
      >
        {family === "nrf52" ? <Nrf52HelpBody /> : <Esp32HelpBody />}
      </AccordionItem>
    </Accordion>
  );
}

// ---- ESP32 body -----------------------------------------------------------

function Esp32HelpBody() {
  const { t } = useCopy();
  return (
    <div className="terminal-block p-4 space-y-3 text-sm">
      <p className="text-default-400">{t("flash.help.esp32.intro")}</p>
      <ol className="list-decimal list-inside space-y-2 text-default-400">
        <li>{renderMono(t("flash.help.esp32.step1"), { this: "this" })}</li>
        <li>{t("flash.help.esp32.step2")}</li>
        <li>{t("flash.help.esp32.step3")}</li>
        <li>
          {renderMono(t("flash.help.esp32.step4"), {
            boot: "BOOT",
            reset: "RESET",
          })}
        </li>
        <li>{t("flash.help.esp32.step5")}</li>
        <li>{t("flash.help.esp32.step6")}</li>
      </ol>
      <div className="pt-2 border-t border-default-200/20">
        <Link
          href="https://meshtastic.org/docs/getting-started/flashing-firmware/"
          isExternal
          showAnchorIcon
          anchorIcon={<ExternalLink className="w-3 h-3 ml-1" />}
          className="text-sm text-primary"
        >
          {t("flash.help.docsLink.esp32")}
        </Link>
      </div>
    </div>
  );
}

// ---- nRF52 body (Plan 25-02-01) -------------------------------------------

function Nrf52HelpBody() {
  const { t } = useCopy();
  return (
    <div className="terminal-block p-4 space-y-3 text-sm">
      <p className="text-default-400">{t("flash.help.nrf52.intro")}</p>
      <ol className="list-decimal list-inside space-y-2 text-default-400">
        <li>{renderMono(t("flash.help.nrf52.step1"), { this: "this" })}</li>
        <li>{t("flash.help.nrf52.step2")}</li>
        <li>
          {renderMono(t("flash.help.nrf52.step3"), {
            doubletap: "double-tap RESET",
            not: "not",
          })}
        </li>
        <li>
          {t("flash.help.nrf52.step4")}
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>
              {renderMono(t("flash.help.nrf52.step4a"), {
                vol1: "T1000-E",
                vol2: "FTHR840BOOT",
              })}
            </li>
            <li>{t("flash.help.nrf52.step4b")}</li>
          </ul>
        </li>
        <li>{t("flash.help.nrf52.step5")}</li>
      </ol>
      <div className="pt-2 border-t border-default-200/20">
        <Link
          href="https://meshtastic.org/docs/getting-started/flashing-firmware/nrf52/"
          isExternal
          showAnchorIcon
          anchorIcon={<ExternalLink className="w-3 h-3 ml-1" />}
          className="text-sm text-primary"
        >
          {t("flash.help.docsLink.nrf52")}
        </Link>
      </div>
    </div>
  );
}
