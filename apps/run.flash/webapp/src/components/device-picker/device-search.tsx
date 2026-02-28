"use client";

import { Input, Chip } from "@heroui/react";
import { Search } from "lucide-react";

interface DeviceSearchProps {
  search: string;
  onSearchChange: (value: string) => void;
  manufacturer: string | null;
  onManufacturerChange: (value: string | null) => void;
  manufacturers: string[];
}

export function DeviceSearch({
  search,
  onSearchChange,
  manufacturer,
  onManufacturerChange,
  manufacturers,
}: DeviceSearchProps) {
  return (
    <div className="space-y-3">
      <Input
        placeholder="Search devices..."
        value={search}
        onValueChange={onSearchChange}
        startContent={<Search className="w-4 h-4 text-default-400" />}
        classNames={{
          inputWrapper: "glass-card glow-focus",
        }}
        isClearable
        onClear={() => onSearchChange("")}
      />

      <div className="flex gap-2 flex-wrap">
        <Chip
          variant={manufacturer === null ? "solid" : "bordered"}
          color="primary"
          className="cursor-pointer"
          onClick={() => onManufacturerChange(null)}
        >
          All
        </Chip>
        {manufacturers.map((m) => (
          <Chip
            key={m}
            variant={manufacturer === m ? "solid" : "bordered"}
            color="primary"
            className="cursor-pointer"
            onClick={() =>
              onManufacturerChange(m === manufacturer ? null : m)
            }
          >
            {m}
          </Chip>
        ))}
      </div>
    </div>
  );
}
