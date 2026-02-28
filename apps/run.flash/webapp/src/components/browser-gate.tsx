"use client";

import { useState, useEffect } from "react";
import { Button } from "@heroui/react";
import { Monitor, ExternalLink } from "lucide-react";

function LoadingSkeleton() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-6 animate-pulse">
        <div className="w-16 h-16 rounded-full bg-content2" />
        <div className="w-48 h-4 rounded bg-content2" />
        <div className="w-32 h-3 rounded bg-content2" />
      </div>
    </div>
  );
}

function UnsupportedBrowserMessage() {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="glass-card rounded-xl p-8 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-content2 flex items-center justify-center">
            <Monitor className="w-8 h-8 text-primary" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-mono matrix-text">
            Web Serial API Required
          </h1>
          <p className="text-default-500 text-sm">
            Flash your Meshtastic device using Chrome or Edge
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            as="a"
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
            variant="solid"
            size="lg"
            endContent={<ExternalLink className="w-4 h-4" />}
          >
            Download Chrome
          </Button>
          <Button
            as="a"
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
            color="default"
            variant="bordered"
            size="lg"
            endContent={<ExternalLink className="w-4 h-4" />}
          >
            Download Edge
          </Button>
        </div>

        <p className="text-default-400 text-xs font-mono">
          Firefox and Safari do not support Web Serial
        </p>
      </div>
    </div>
  );
}

export function BrowserGate({ children }: { children: React.ReactNode }) {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setIsSupported("serial" in navigator);
  }, []);

  if (isSupported === null) return <LoadingSkeleton />;
  if (!isSupported) return <UnsupportedBrowserMessage />;
  return <>{children}</>;
}
