"use client";

import { CheckCircle2 } from "lucide-react";
import type { ChipInfo } from "@/types/serial";

interface ConnectionStatusProps {
  chipInfo: ChipInfo;
}

/**
 * Connected device status display showing chip info.
 * Renders a glass-card with green success theme indicating active connection.
 */
export function ConnectionStatus({ chipInfo }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      {/* Pulsing green dot + check */}
      <div className="flex-shrink-0 relative">
        <CheckCircle2 className="w-8 h-8 text-teal-400" />
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-teal-400 animate-pulse" />
      </div>

      <div className="space-y-1 min-w-0">
        <h3 className="font-mono text-lg text-teal-400">Connected</h3>
        <div className="space-y-0.5 text-sm">
          <p>
            <span className="text-default-400">Chip:</span>{" "}
            <span className="font-mono text-default-100">
              {chipInfo.chipName}
            </span>
          </p>
          <p className="truncate">
            <span className="text-default-400">Details:</span>{" "}
            <span className="font-mono text-default-100">
              {chipInfo.chipDescription}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
