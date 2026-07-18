"use client";

import { CheckCircle2 } from "lucide-react";
import type { ChipInfo } from "@/types/serial";
import { useCopy } from "@/components/CopyProvider";

interface ConnectionStatusProps {
  chipInfo: ChipInfo;
}

/**
 * Connected device status display showing chip info.
 * Renders a glass-card with green success theme indicating active connection.
 */
export function ConnectionStatus({ chipInfo }: ConnectionStatusProps) {
  const { t } = useCopy();
  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      {/* Pulsing green dot + check */}
      <div className="flex-shrink-0 relative">
        <CheckCircle2 className="w-8 h-8 text-primary" />
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary animate-pulse" />
      </div>

      <div className="space-y-1 min-w-0">
        <h3 className="font-mono text-lg text-primary">{t("flash.connect.connected")}</h3>
        <div className="space-y-0.5 text-sm">
          <p>
            <span className="text-default-500">{t("flash.connect.chipLabel")}</span>{" "}
            <span className="font-mono text-foreground">
              {chipInfo.chipName}
            </span>
          </p>
          <p className="truncate">
            <span className="text-default-500">{t("flash.connect.detailsLabel")}</span>{" "}
            <span className="font-mono text-foreground">
              {chipInfo.chipDescription}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
