import { Link } from "@heroui/react";
import { ExternalLink } from "lucide-react";

export function DeviceNotFound() {
  return (
    <div className="terminal-block rounded-xl p-8 text-center space-y-3">
      <h3 className="text-lg font-semibold text-foreground">
        No matching devices found
      </h3>
      <p className="text-default-500 text-sm max-w-md mx-auto">
        Can&apos;t find your device? It may not be ESP32-based or not supported
        by Meshtastic.
      </p>
      <Link
        href="https://flasher.meshtastic.org"
        isExternal
        showAnchorIcon
        anchorIcon={<ExternalLink className="w-3.5 h-3.5 ml-1" />}
        color="primary"
        className="text-sm font-mono"
      >
        Try the full Meshtastic flasher
      </Link>
    </div>
  );
}
