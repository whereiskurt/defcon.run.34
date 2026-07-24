"use client";

import { Chip, Select, SelectItem } from "@heroui/react";
import { FIRMWARE_VERSIONS } from "@/config/firmware";

interface FirmwareVersionSelectProps {
  value: string;
  onChange: (version: string) => void;
}

/** Firmware version dropdown, populated from the build-time manifest.
 *  Keys are the full meshtastic version strings; the default entry is
 *  preselected by the wizard container. */
export function FirmwareVersionSelect({
  value,
  onChange,
}: FirmwareVersionSelectProps) {
  return (
    <Select
      aria-label="Firmware version"
      selectedKeys={[value]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const key = Array.from(keys)[0];
        if (typeof key === "string") onChange(key);
      }}
      size="sm"
      className="w-64"
      classNames={{ trigger: "font-mono" }}
    >
      {FIRMWARE_VERSIONS.map((v) => (
        <SelectItem key={v.version} textValue={`Meshtastic ${v.version}`}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{v.label}</span>
            {v.experimental && (
              <Chip size="sm" variant="flat" color="warning">
                experimental
              </Chip>
            )}
          </div>
        </SelectItem>
      ))}
    </Select>
  );
}
