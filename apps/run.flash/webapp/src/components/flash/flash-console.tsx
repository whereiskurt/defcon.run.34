"use client";

import { useEffect, useRef } from "react";
import { Accordion, AccordionItem } from "@heroui/react";
import { Terminal } from "lucide-react";
import type { ConsoleEntry } from "@/types/serial";

interface FlashConsoleProps {
  logs: ConsoleEntry[];
  /** Start expanded (useful on error for debugging) */
  defaultExpanded?: boolean;
}

/**
 * Expandable console showing raw esptool.js serial output.
 * Per CONTEXT.md: hidden by default, "Show details" toggle reveals raw output.
 * Auto-scrolls to bottom when new entries arrive.
 */
export function FlashConsole({ logs, defaultExpanded = false }: FlashConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Accordion
      variant="bordered"
      defaultExpandedKeys={defaultExpanded ? ["console"] : []}
    >
      <AccordionItem
        key="console"
        aria-label="Show details"
        title={
          <span className="flex items-center gap-2 text-sm font-mono text-default-400">
            <Terminal className="w-4 h-4" />
            Show details
          </span>
        }
      >
        <div
          ref={scrollRef}
          className="bg-black rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs"
        >
          {logs.length === 0 ? (
            <span className="text-zinc-400">Waiting for output...</span>
          ) : (
            logs.map((entry, i) => (
              <span key={i} className="text-teal-300 whitespace-pre-wrap">
                {entry.text}
              </span>
            ))
          )}
        </div>
      </AccordionItem>
    </Accordion>
  );
}
