"use client";

import { Button } from "@heroui/react";
import { Download, ExternalLink, Smartphone } from "lucide-react";
import { APP_DOWNLOADS, getAppHref } from "@/config/apps";

interface AppDownloadsCardProps {
  /** "full" = Done-step card with sublabels + sideload note;
   *  "compact" = single row of buttons for the device-picker screen. */
  variant?: "full" | "compact";
}

/** Self-hosted phone-app downloads (2 Android APKs mirrored to our S3) plus
 *  the iOS App Store link. APKs are pinned build-time artifacts — see
 *  app-downloads.sources.json. */
export function AppDownloadsCard({ variant = "full" }: AppDownloadsCardProps) {
  if (variant === "compact") {
    return (
      <div className="glass-card rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-default-500">
          <Smartphone className="w-4 h-4" />
          <span className="font-mono">Phone app:</span>
        </div>
        {APP_DOWNLOADS.map((app) => (
          <Button
            key={app.id}
            as="a"
            href={getAppHref(app)}
            {...(app.kind === "apk"
              ? { download: app.filename }
              : { target: "_blank", rel: "noopener noreferrer" })}
            size="sm"
            variant="flat"
            color="primary"
            startContent={
              app.kind === "apk" ? (
                <Download className="w-3.5 h-3.5" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )
            }
            className="font-mono"
          >
            {app.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-5">
      <h3 className="text-sm font-mono text-default-500 uppercase tracking-wider mb-4">
        Get the phone app
      </h3>
      <div className="space-y-3">
        {APP_DOWNLOADS.map((app) => (
          <div key={app.id} className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-default-400 flex-shrink-0" />
            <div className="text-sm flex-1 min-w-0">
              <div className="text-foreground">{app.label}</div>
              <div className="text-xs text-default-500 mt-0.5">
                {app.sublabel}
              </div>
            </div>
            <Button
              as="a"
              href={getAppHref(app)}
              {...(app.kind === "apk"
                ? { download: app.filename }
                : { target: "_blank", rel: "noopener noreferrer" })}
              size="sm"
              variant="flat"
              color="primary"
              startContent={
                app.kind === "apk" ? (
                  <Download className="w-3.5 h-3.5" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )
              }
              className="flex-shrink-0 font-mono"
            >
              {app.kind === "apk" ? "Download APK" : "App Store"}
            </Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-default-500 mt-4">
        Android APKs install directly — your phone will ask you to allow
        installs from unknown sources. Both are official Meshtastic builds,
        mirrored here so they work on con Wi-Fi.
      </p>
    </div>
  );
}
