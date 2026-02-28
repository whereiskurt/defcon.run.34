"use client";

import { Card, CardBody, Chip } from "@heroui/react";
import clsx from "clsx";
import type { DeviceHardware } from "@/types/device";
import {
  isRecommended,
  getDeviceImagePath,
  getManufacturer,
  getArchLabel,
} from "@/config/devices";

const ARCH_COLORS: Record<string, "primary" | "secondary" | "warning" | "success"> = {
  esp32: "primary",
  "esp32-s3": "secondary",
  "esp32-c3": "warning",
  "esp32-c6": "success",
};

interface DeviceCardProps {
  device: DeviceHardware;
  isSelected: boolean;
  onSelect: () => void;
}

export function DeviceCard({ device, isSelected, onSelect }: DeviceCardProps) {
  const recommended = isRecommended(device);
  const imagePath = getDeviceImagePath(device);
  const manufacturer = getManufacturer(device);
  const archLabel = getArchLabel(device);
  const archColor = ARCH_COLORS[device.architecture] || "primary";

  return (
    <Card
      isPressable
      onPress={onSelect}
      className={clsx(
        "glass-card min-h-[200px] transition-all duration-200 relative",
        isSelected &&
          "ring-2 ring-primary bg-content2 !border-primary/60 !shadow-[0_0_16px_#00d4aa40]",
        !device.activelySupported && "opacity-60"
      )}
    >
      {/* Recommended badge */}
      {recommended && (
        <div className="absolute top-2 right-2 z-10">
          <Chip size="sm" color="success" variant="flat">
            Recommended
          </Chip>
        </div>
      )}

      <CardBody className="flex flex-col items-center gap-3 p-4">
        {/* Device SVG image */}
        <div className="w-full h-[120px] flex items-center justify-center p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagePath}
            alt={device.displayName}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {/* Device name */}
        <h3 className="font-mono text-sm text-center leading-tight">
          {device.displayName}
        </h3>

        {/* Tags row */}
        <div className="flex gap-1.5 flex-wrap justify-center">
          <Chip size="sm" variant="bordered" className="text-xs">
            {manufacturer}
          </Chip>
          <Chip size="sm" variant="flat" color={archColor} className="text-xs">
            {archLabel}
          </Chip>
        </div>
      </CardBody>
    </Card>
  );
}
