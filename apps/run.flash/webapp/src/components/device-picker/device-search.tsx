"use client";

import { Input } from "@heroui/react";
import { Search } from "lucide-react";

interface DeviceSearchProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export function DeviceSearch({
  search,
  onSearchChange,
}: DeviceSearchProps) {
  return (
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
  );
}
