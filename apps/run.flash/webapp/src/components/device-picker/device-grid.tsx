"use client";

import type { DeviceHardware } from "@/types/device";

interface DeviceGridProps {
  onSelect: (device: DeviceHardware) => void;
  selectedDevice: DeviceHardware | null;
}

/**
 * Stub device grid -- replaced with full implementation in Task 2.
 */
export function DeviceGrid({ onSelect, selectedDevice }: DeviceGridProps) {
  void onSelect;
  void selectedDevice;
  return (
    <div className="glass-card rounded-xl p-8 text-center">
      <p className="text-default-400 font-mono text-sm">
        Loading device picker...
      </p>
    </div>
  );
}
