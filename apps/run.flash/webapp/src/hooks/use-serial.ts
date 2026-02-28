"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChipInfo, SerialConnectionState, ConsoleEntry } from "@/types/serial";
import {
  connectToDevice,
  createTerminalLogger,
  getConnectionErrorMessage,
} from "@/lib/esptool";
import type { ESPLoader, Transport } from "esptool-js";

interface UseSerialReturn {
  /** Current connection state */
  connectionState: SerialConnectionState;
  /** Detected chip info (null if not connected) */
  chipInfo: ChipInfo | null;
  /** Error message (null if no error) */
  error: string | null;
  /** Console log entries from esptool.js */
  consoleLogs: ConsoleEntry[];
  /** Whether currently connecting */
  isConnecting: boolean;
  /** Whether connected and chip detected */
  isConnected: boolean;
  /**
   * Initiate serial connection. MUST be called from a user gesture (click handler).
   * Calls navigator.serial.requestPort() then connects via esptool.js.
   */
  connect: () => Promise<void>;
  /** Disconnect and clean up serial resources */
  disconnect: () => Promise<void>;
  /** Clear error state (e.g., before retry) */
  clearError: () => void;
  /** Clear console logs */
  clearLogs: () => void;
  /** Append a log entry to the console (for external callers like useFlash) */
  appendLog: (text: string) => void;
  /** ESPLoader ref for use by useFlash (internal) */
  espLoaderRef: React.RefObject<ESPLoader | null>;
  /** Transport ref for cleanup (internal) */
  transportRef: React.RefObject<Transport | null>;
}

/**
 * Hook for managing Web Serial connection to an ESP32 device.
 *
 * Encapsulates:
 * - navigator.serial.requestPort() (browser serial prompt)
 * - esptool.js Transport + ESPLoader initialization
 * - Chip detection (chip name and description)
 * - Error handling with actionable messages
 * - Console log capture from esptool.js raw output
 * - Cleanup on disconnect, error, and unmount
 *
 * IMPORTANT: ESPLoader and Transport are stored in refs (not state)
 * because they are mutable class instances with internal state.
 * Only derived values (chipInfo, connectionState) are in React state.
 */
export function useSerial(): UseSerialReturn {
  const [connectionState, setConnectionState] =
    useState<SerialConnectionState>("disconnected");
  const [chipInfo, setChipInfo] = useState<ChipInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);

  // Store mutable esptool.js instances in refs, NOT state
  const espLoaderRef = useRef<ESPLoader | null>(null);
  const transportRef = useRef<Transport | null>(null);

  // Append a log entry for the expandable console
  const appendLog = useCallback((text: string) => {
    setConsoleLogs((prev) => [...prev, { timestamp: Date.now(), text }]);
  }, []);

  // Disconnect and clean up serial resources
  const disconnect = useCallback(async () => {
    try {
      if (transportRef.current) {
        await transportRef.current.disconnect();
      }
    } catch {
      // Ignore disconnect errors (port may already be closed)
    }
    espLoaderRef.current = null;
    transportRef.current = null;
    setConnectionState("disconnected");
    setChipInfo(null);
  }, []);

  // Connect to device via Web Serial + esptool.js
  const connect = useCallback(async () => {
    // Clean up any existing connection first
    await disconnect();
    setError(null);
    setConnectionState("connecting");

    try {
      // requestPort() MUST be called in a user gesture handler
      // The browser will show its native serial port picker dialog
      const port = await navigator.serial.requestPort();

      // Create terminal logger for console output capture
      const terminal = createTerminalLogger(appendLog);

      // Connect and detect chip
      const result = await connectToDevice(port, terminal);

      espLoaderRef.current = result.espLoader;
      transportRef.current = result.transport;
      setChipInfo(result.chipInfo);
      setConnectionState("connected");
    } catch (err) {
      // User cancelled the port picker dialog -- not an error
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setConnectionState("disconnected");
        return;
      }

      const message = getConnectionErrorMessage(err);
      setError(message);
      setConnectionState("error");
      appendLog(`\nERROR: ${message}\n`);
    }
  }, [disconnect, appendLog]);

  const clearError = useCallback(() => {
    setError(null);
    if (connectionState === "error") {
      setConnectionState("disconnected");
    }
  }, [connectionState]);

  const clearLogs = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  // Cleanup on unmount -- disconnect transport to release serial port
  useEffect(() => {
    return () => {
      if (transportRef.current) {
        transportRef.current.disconnect().catch(() => {});
      }
    };
  }, []);

  return {
    connectionState,
    chipInfo,
    error,
    consoleLogs,
    isConnecting: connectionState === "connecting",
    isConnected: connectionState === "connected",
    connect,
    disconnect,
    clearError,
    clearLogs,
    appendLog,
    espLoaderRef,
    transportRef,
  };
}
