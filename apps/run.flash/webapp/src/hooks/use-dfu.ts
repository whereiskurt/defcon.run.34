"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ConsoleEntry } from "@/types/serial";
import type { DfuDevice } from "@/lib/web-dfu";
import { openDfu, closeDfu, getDfuErrorMessage } from "@/lib/web-dfu";

/** DFU connection state machine — parallel to SerialConnectionState. */
export type DfuConnectionState =
  | "disconnected" // No USB device selected
  | "connecting" // Device selected, opening + claiming DFU interface
  | "connected" // DFU interface claimed, ready to write
  | "error"; // Connection failed

export interface UseDfuReturn {
  /** Current connection state */
  connectionState: DfuConnectionState;
  /** Claimed DFU device (null if not connected) */
  dfuDevice: DfuDevice | null;
  /** Error message (null if no error) */
  error: string | null;
  /** Console log entries (shared display with useSerial) */
  consoleLogs: ConsoleEntry[];
  /** Whether currently connecting */
  isConnecting: boolean;
  /** Whether connected and DFU interface claimed */
  isConnected: boolean;
  /**
   * Initiate DFU connection. MUST be called from a user gesture (click handler).
   * Calls navigator.usb.requestDevice() then openDfu() on the selected device.
   * Silently returns on NotAllowedError (user cancelled the USB picker).
   */
  connect: () => Promise<void>;
  /** Disconnect and release the USB interface */
  disconnect: () => Promise<void>;
  /** Clear error state (e.g., before retry) */
  clearError: () => void;
  /** Clear console logs */
  clearLogs: () => void;
  /** Append a log entry to the console (for external callers like useFlash) */
  appendLog: (text: string) => void;
  /** DfuDevice ref for use by useFlash router (internal) */
  dfuDeviceRef: React.RefObject<DfuDevice | null>;
}

/**
 * Hook for managing a Web USB DFU connection to an nRF52840 device.
 *
 * Structural parallel to useSerial (see src/hooks/use-serial.ts):
 * - navigator.usb.requestDevice() with DFU class filter (0xFE / 0x01)
 * - openDfu() lifecycle wrapping open + configuration + claim + selectAlt
 * - Cleanup on disconnect, error, and unmount
 * - Silent NotAllowedError (user cancelled the browser USB picker)
 *
 * The DfuDevice is stored in a ref because openDfu returns a value with an
 * underlying USBDevice class instance (mutable + non-serialisable). Only
 * derived state (connectionState, error) is in React state.
 */
export function useDfu(): UseDfuReturn {
  const [connectionState, setConnectionState] =
    useState<DfuConnectionState>("disconnected");
  const [dfuDevice, setDfuDevice] = useState<DfuDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);

  const dfuDeviceRef = useRef<DfuDevice | null>(null);

  const appendLog = useCallback((text: string) => {
    setConsoleLogs((prev) => [...prev, { timestamp: Date.now(), text }]);
  }, []);

  // Disconnect DFU: release the interface and close the USB device.
  // Safe to call when already disconnected.
  const disconnect = useCallback(async () => {
    const current = dfuDeviceRef.current;
    if (current) {
      try {
        await closeDfu(current);
      } catch {
        // Ignore — the device may already be gone (post-flash reset).
      }
    }
    dfuDeviceRef.current = null;
    setDfuDevice(null);
    setConnectionState("disconnected");
  }, []);

  // Connect to a DFU device via Web USB.
  // Filters on DFU class (0xFE) + subclass (0x01) so the browser picker
  // only offers devices in DFU mode. Users double-tap RESET on the T-1000E
  // to enter the Adafruit bootloader, which enumerates as a DFU device.
  const connect = useCallback(async () => {
    await disconnect();
    setError(null);
    setConnectionState("connecting");

    try {
      // requestDevice() MUST be called in a user gesture handler.
      // The browser shows its native USB device picker.
      const usbDevice = await navigator.usb.requestDevice({
        filters: [{ classCode: 0xfe, subclassCode: 0x01 }],
      });

      appendLog(
        `USB device selected: ${usbDevice.productName ?? "(unknown)"} ` +
          `[${usbDevice.vendorId.toString(16).padStart(4, "0")}:${usbDevice.productId
            .toString(16)
            .padStart(4, "0")}]\n`
      );

      const opened = await openDfu(usbDevice);
      dfuDeviceRef.current = opened;
      setDfuDevice(opened);
      setConnectionState("connected");
      appendLog("DFU interface claimed. Ready to flash.\n");
    } catch (err) {
      // User cancelled the USB picker dialog — not an error.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setConnectionState("disconnected");
        return;
      }

      const message = getDfuErrorMessage(err);
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

  // Cleanup on unmount — release the interface so the next mount can claim it.
  useEffect(() => {
    return () => {
      const current = dfuDeviceRef.current;
      if (current) {
        closeDfu(current).catch(() => {});
      }
    };
  }, []);

  return {
    connectionState,
    dfuDevice,
    error,
    consoleLogs,
    isConnecting: connectionState === "connecting",
    isConnected: connectionState === "connected",
    connect,
    disconnect,
    clearError,
    clearLogs,
    appendLog,
    dfuDeviceRef,
  };
}
