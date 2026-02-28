"use client";

import { useState, useMemo } from "react";
import { Button, Chip } from "@heroui/react";
import type { DeviceHardware } from "@/types/device";
import { isEsp32Device } from "@/types/device";
import {
  sortDevices,
  deduplicateDevices,
  MANUFACTURERS,
} from "@/config/devices";
import { DeviceCard } from "@/components/device-picker/device-card";
import { DeviceSearch } from "@/components/device-picker/device-search";
import { DeviceNotFound } from "@/components/device-picker/device-not-found";
import deviceData from "@/../public/data/hardware-list.json";

interface DeviceGridProps {
  onSelect: (device: DeviceHardware) => void;
  selectedDevice: DeviceHardware | null;
  onContinue?: () => void;
}

export function DeviceGrid({ onSelect, selectedDevice, onContinue }: DeviceGridProps) {
  const [search, setSearch] = useState("");
  const [manufacturer, setManufacturer] = useState<string | null>(null);

  // Filter to ESP32 devices and deduplicate
  const esp32Devices = useMemo(() => {
    const allDevices = deviceData as DeviceHardware[];
    return deduplicateDevices(allDevices.filter(isEsp32Device));
  }, []);

  // Extract actual manufacturers present in ESP32 devices
  const availableManufacturers = useMemo(() => {
    const mfrs = new Set<string>();
    for (const device of esp32Devices) {
      if (device.tags?.[0]) mfrs.add(device.tags[0]);
    }
    // Return only MANUFACTURERS that actually have devices
    return MANUFACTURERS.filter((m) => mfrs.has(m));
  }, [esp32Devices]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = esp32Devices;

    if (manufacturer) {
      result = result.filter((d) => d.tags?.includes(manufacturer));
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.displayName.toLowerCase().includes(q) ||
          d.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    return sortDevices(result);
  }, [esp32Devices, search, manufacturer]);

  return (
    <div className="space-y-4">
      {/* Row 1: Search input + Continue button, full width */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <DeviceSearch
            search={search}
            onSearchChange={setSearch}
          />
        </div>
        <Button
          color="primary"
          size="lg"
          isDisabled={!onContinue}
          onPress={onContinue}
          className="font-mono whitespace-nowrap"
        >
          {selectedDevice
            ? `Continue with ${selectedDevice.displayName}`
            : "Select a device to continue"}
        </Button>
      </div>

      {/* Row 2: Manufacturer filter pills — full width */}
      <div className="flex gap-2 flex-wrap">
        <Chip
          variant={manufacturer === null ? "solid" : "bordered"}
          color="primary"
          className="cursor-pointer"
          onClick={() => setManufacturer(null)}
        >
          All
        </Chip>
        {(availableManufacturers as string[]).map((m) => (
          <Chip
            key={m}
            variant={manufacturer === m ? "solid" : "bordered"}
            color="primary"
            className="cursor-pointer"
            onClick={() => setManufacturer(m === manufacturer ? null : m)}
          >
            {m}
          </Chip>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((device) => (
            <DeviceCard
              key={`${device.hwModel}-${device.platformioTarget}`}
              device={device}
              isSelected={selectedDevice?.hwModel === device.hwModel}
              onSelect={() => onSelect(device)}
            />
          ))}
        </div>
      ) : (
        <DeviceNotFound />
      )}
    </div>
  );
}
