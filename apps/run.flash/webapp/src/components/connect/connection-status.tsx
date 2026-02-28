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
    <div className="glass-card rounded-xl p-5 border-green-500/30 shadow-[0_0_16px_rgba(34,197,94,0.1)]">
      <div className="flex items-start gap-4">
        {/* Pulsing green dot + check */}
        <div className="flex-shrink-0 relative">
          <CheckCircle2 className="w-8 h-8 text-green-400" />
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 animate-pulse" />
        </div>

        <div className="space-y-2">
          <h3 className="font-mono text-lg text-green-400">Connected</h3>
          <div className="space-y-1 text-sm">
            <p className="text-default-300">
              <span className="text-default-500">Chip:</span>{" "}
              <span className="font-mono text-default-200">
                {chipInfo.chipName}
              </span>
            </p>
            <p className="text-default-300">
              <span className="text-default-500">Details:</span>{" "}
              <span className="font-mono text-default-200">
                {chipInfo.chipDescription}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
