"use client";

import { Link } from "@heroui/react";
import { ExternalLink } from "lucide-react";
import { useCopy } from "@/components/CopyProvider";

export function DeviceNotFound() {
  const { t } = useCopy();
  return (
    <div className="terminal-block rounded-xl p-8 text-center space-y-3">
      <h3 className="text-lg font-semibold text-foreground">
        {t("flash.picker.notFoundTitle")}
      </h3>
      <p className="text-default-500 text-sm max-w-md mx-auto">
        {t("flash.picker.notFoundBody")}
      </p>
      <Link
        href="https://flasher.meshtastic.org"
        isExternal
        showAnchorIcon
        anchorIcon={<ExternalLink className="w-3.5 h-3.5 ml-1" />}
        color="primary"
        className="text-sm font-mono"
      >
        {t("flash.picker.fullFlasherLink")}
      </Link>
    </div>
  );
}
