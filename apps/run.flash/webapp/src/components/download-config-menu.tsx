"use client";

import { useCallback, useState } from "react";
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/react";
import { Download, FileText } from "lucide-react";
import type { DeviceConfigPayload } from "@/types/config";
import { downloadConfig, type ExportFormat } from "@/lib/config-export";
import { useCopy } from "@/components/CopyProvider";

const basePath = process.env.NODE_ENV === "production" ? "/use1" : "";

interface DownloadConfigMenuProps {
  /** Config when the caller already fetched it (configure step); null = the
   *  menu fetches /api/config itself on first open (landing card). */
  payload: DeviceConfigPayload | null;
  /** "button" = compact dropdown button; "card" = glass-card with blurb for
   *  the device-picker (manual-setup) placement. */
  variant: "button" | "card";
}

/**
 * Download the exact config the flasher would push — for manual setup without
 * WebSerial (iPhone, pre-flashed radios, CLI users). Three formats: readable
 * txt, raw json, meshtastic-CLI sh. Files contain the user's own MQTT
 * password + channel PSKs (same secrets this authed page already handles).
 */
export function DownloadConfigMenu({ payload, variant }: DownloadConfigMenuProps) {
  const { t } = useCopy();
  const [fetched, setFetched] = useState<DeviceConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const effective = payload ?? fetched;

  const ensurePayload = useCallback(async (): Promise<DeviceConfigPayload | null> => {
    if (payload) return payload;
    if (fetched) return fetched;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/config`);
      if (res.status === 404) {
        setError(t("flash.downloadConfig.notProvisioned"));
        return null;
      }
      if (!res.ok) {
        setError(t("flash.downloadConfig.error"));
        return null;
      }
      const p = (await res.json()) as DeviceConfigPayload;
      setFetched(p);
      return p;
    } catch {
      setError(t("flash.downloadConfig.error"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [payload, fetched, t]);

  const handleAction = useCallback(
    async (key: React.Key) => {
      const p = await ensurePayload();
      if (p) downloadConfig(p, key as ExportFormat);
    },
    [ensurePayload]
  );

  const dropdown = (
    <Dropdown>
      <DropdownTrigger>
        <Button
          size="sm"
          variant="flat"
          color="primary"
          isLoading={loading}
          startContent={!loading && <Download className="w-3.5 h-3.5" />}
          className="font-mono"
        >
          {t("flash.downloadConfig.button")}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Download config format" onAction={handleAction}>
        <DropdownItem key="txt">{t("flash.downloadConfig.txt")}</DropdownItem>
        <DropdownItem key="json">{t("flash.downloadConfig.json")}</DropdownItem>
        <DropdownItem key="sh">{t("flash.downloadConfig.sh")}</DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );

  if (variant === "button") {
    return (
      <div className="flex flex-col items-start gap-1">
        {dropdown}
        {error && !effective && <p className="text-xs text-warning-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-default-500">
        <FileText className="w-4 h-4" />
        <span className="font-mono">{t("flash.downloadConfig.cardTitle")}:</span>
      </div>
      <p className="text-xs text-default-500 flex-1 min-w-[12rem]">
        {t("flash.downloadConfig.cardBody")}
      </p>
      {dropdown}
      {error && !effective && (
        <p className="basis-full text-xs text-warning-600">{error}</p>
      )}
    </div>
  );
}
