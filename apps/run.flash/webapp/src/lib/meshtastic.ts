"use client";

/**
 * @meshtastic/core wrapper library.
 * All direct @meshtastic library calls are encapsulated here -- hooks/components
 * call these wrapper functions. Follows the same pattern as lib/esptool.ts.
 */
import type { DeviceConfigPayload } from "@/types/config";
import { MeshDevice, Protobuf, Types } from "@meshtastic/core";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";
import { create } from "@bufbuild/protobuf";
import { buildRingtoneAdminMessageBytes } from "@/lib/ringtone-admin";
import { isValidRtttl } from "@/lib/rtttl";
import { buildShortName, clampLongName } from "@/lib/identity";
import { formatMqttAddress, verifyMqttConfig } from "@/lib/verify-config";
import { awaitAckTolerant } from "@/lib/ack-tolerant";

/** Info captured during configure handshake for auto-registration */
export type DeviceRegistrationInfo = {
  /** Hex node ID in "!abcd1234" format */
  nodeId: string;
  /** Base64-encoded private key from device security config */
  privateKey: string;
  /** Base64-encoded public key from device security config */
  publicKey: string;
};

/** Default baud rate for Meshtastic serial communication */
const MESHTASTIC_BAUDRATE = 115200;

/** Post-flash reboot delay in milliseconds */
const REBOOT_DELAY_MS = 4000;

/** Time to drain boot/debug text from serial buffer (ms).
 * ESP32-S3 USB-JTAG sends boot messages + debug text on DTR assertion
 * that contains 0x94 bytes which poison the library's framing parser. */
const DRAIN_TIMEOUT_MS = 2000;

/** Retry delay between connection attempts in milliseconds */
const RETRY_DELAY_MS = 2000;

/** Maximum number of configure() retry attempts */
const MAX_CONFIGURE_RETRIES = 3;

/** Timeout for waiting for DeviceConfigured status (ms) -- needs to be long enough
 * for the device to finish dumping its entire config back to us */
const CONFIGURE_TIMEOUT_MS = 60000;

/** Settle delay between commitEditSettings and the post-commit read-backs (ms) */
const COMMIT_SETTLE_MS = 1500;

/** Native-USB reconnect: total time to wait for the firmware to come up (ms) */
const NATIVE_USB_BOOT_TIMEOUT_MS = 90000;

/** Native-USB reconnect: how long before prompting the user to power-cycle (ms) */
const NATIVE_USB_PROMPT_AFTER_MS = 6000;

/** Native-USB reconnect: after this long, accept an openable-but-silent port
 *  and let the Meshtastic handshake decide (a quietly-running firmware may
 *  emit no spontaneous boot text) (ms) */
const NATIVE_USB_SILENT_FALLBACK_MS = 30000;

/** Native-USB reconnect: per-port listen window while polling (ms) */
const NATIVE_USB_READ_WINDOW_MS = 1500;

/** Native-USB reconnect: gap between poll passes (ms) */
const NATIVE_USB_POLL_GAP_MS = 300;

/** Options for the ESP32 configure-step reconnect. */
export type Esp32ConnectOptions = {
  /** Native-USB board (ESP32-S3/C3/C6, e.g. T-Beam 1W): the classic DTR/RTS
   *  reset cannot be relied on to exit the ROM bootloader, and a manual
   *  power-cycle re-enumerates USB, invalidating held port handles. Uses the
   *  adaptive poll + power-cycle-prompt reconnect instead of the blind
   *  fixed-delay reboot dance. */
  nativeUsb?: boolean;
  /** Fires true when the user needs to power-cycle the device, false once
   *  the device has been heard from (or the wait ends). */
  onAwaitingUserReset?: (waiting: boolean) => void;
};

/**
 * Connect to a Meshtastic device over Web Serial after flash reboot.
 *
 * Uses navigator.serial.getPorts() to reuse the already-granted port
 * (no user gesture needed -- permission was granted during connect step).
 *
 * Includes retry logic for post-flash reboot delay:
 * - 4 second initial delay for device boot
 * - Retry configure() up to 3 times with 2s delay between attempts
 * - 60 second timeout per attempt waiting for DeviceConfigured status
 *
 * IMPORTANT: The device MUST reach DeviceConfigured status (7) before
 * admin commands (setConfig, setModuleConfig, etc.) will be accepted.
 * The configure handshake populates myNodeInfo which is required for
 * proper packet addressing.
 *
 * @returns Connected and configured MeshDevice instance with registration info
 * @throws Error if connection times out or no port available
 */
export async function connectMeshtasticDevice(
  options: Esp32ConnectOptions = {}
): Promise<{
  device: MeshDevice;
  registrationInfo: DeviceRegistrationInfo;
}> {
  // Step 1: Get the previously-granted serial port. On a native-USB board an
  // empty list is not fatal — a power-cycle re-enumerates USB, so the poll
  // below (plus the manual port-select fallback) can still find the device.
  const ports = await navigator.serial.getPorts();
  if (ports.length === 0 && !options.nativeUsb) {
    throw new Error(
      "No serial port available. The device may have disconnected during reboot."
    );
  }

  // Step 2: Hard-reset the device out of bootloader mode.
  // The Connect step uses ESPLoader.main() which puts the device into ROM
  // bootloader mode. esptool's disconnect() already closed the port, so
  // we must reopen it briefly to toggle DTR/RTS and trigger a hardware
  // reset via the auto-reset circuitry. On native-USB boards this reaches the
  // chip's USB-Serial/JTAG peripheral instead of an auto-reset circuit — it
  // works on some (Heltec V3-class) and is a no-op on others (T-Beam 1W),
  // which is why the native-USB path doesn't trust it and polls instead.
  if (ports.length > 0) {
    const resetPort = ports[0];
    console.log("[meshtastic] Resetting device out of bootloader mode...");
    try {
      // Open the port if not already open (esptool closed it)
      if (!resetPort.readable || !resetPort.writable) {
        await resetPort.open({ baudRate: MESHTASTIC_BAUDRATE });
      }
      // Reset-to-application sequence:
      // RTS=true pulls EN LOW (reset), DTR=false keeps GPIO0 HIGH (no bootloader)
      await resetPort.setSignals({ dataTerminalReady: false, requestToSend: true });
      await new Promise((r) => setTimeout(r, 100));
      // Release EN — device boots into application firmware
      await resetPort.setSignals({ dataTerminalReady: false, requestToSend: false });
      await new Promise((r) => setTimeout(r, 50));
      console.log("[meshtastic] DTR/RTS reset sequence sent");
      // Close the port so we can reopen cleanly for Meshtastic
      await resetPort.close();
    } catch (err) {
      console.warn("[meshtastic] Reset via setSignals failed:", err);
      // If port is still open, close it
      try { if (resetPort.readable || resetPort.writable) await resetPort.close(); } catch { /* ignore */ }
    }
  }

  let port: SerialPort;
  if (options.nativeUsb) {
    // Native-USB (ESP32-S3/C3/C6): the reset above may not have done anything,
    // and if the user power-cycles instead, USB re-enumerates and old handles
    // die. Poll fresh enumerations until the firmware is heard from, prompting
    // the user to power-cycle if nothing shows up.
    port = await waitForFirmwareBootNativeUsb(options.onAwaitingUserReset);
  } else {
    // Classic ESP32 (CP210x/CH9102 bridge): the reset reliably worked and the
    // bridge chip stays enumerated, so the original fixed-delay dance holds.
    port = ports[0];

    // Step 3: Wait for the device to boot Meshtastic firmware.
    console.log(`[meshtastic] Waiting ${REBOOT_DELAY_MS}ms for device to boot firmware...`);
    await new Promise((resolve) => setTimeout(resolve, REBOOT_DELAY_MS));

    // Step 4: Drain boot/debug text from serial buffer.
    // Boot messages and debug text (sent when DTR is asserted) contain 0x94
    // bytes (from ASCII like "ESP-ROM:...") that poison @meshtastic/core's
    // fromDeviceStream parser — it finds the false 0x94, checks if the next
    // byte is 0xC3, it's not, and the parser stops processing forever (never
    // recovers from a false framing byte match). We must drain this text
    // before creating the MeshDevice.
    console.log("[meshtastic] Draining boot/debug text from serial buffer...");
    await port.open({ baudRate: MESHTASTIC_BAUDRATE });
    await port.setSignals({ dataTerminalReady: true });
    const drainedBytes = await readForWindow(port, DRAIN_TIMEOUT_MS);
    console.log(`[meshtastic] Drained ${drainedBytes} bytes of boot text`);
    await port.close();
  }

  // Step 5: Reopen the port cleanly for Meshtastic protocol.
  // The serial buffer is now clear of boot text — the library's
  // fromDeviceStream parser won't hit false 0x94 framing bytes.
  const transport = await TransportWebSerial.createFromPort(
    port,
    MESHTASTIC_BAUDRATE
  );
  await port.setSignals({ dataTerminalReady: true });

  // Step 6: Create MeshDevice with transport
  const device = new MeshDevice(transport);

  // Step 7: Wait for transport to reach DeviceConnected.
  // TransportWebSerial.createFromPort() returns immediately -- the transport's
  // internal ReadableStream start() callback connects asynchronously. If we
  // call configure() before DeviceConnected fires, the wantConfigId packet
  // is queued into sendRaw() before the serial writable stream is ready and
  // gets silently lost. The device never receives it, so configCompleteId
  // never comes back.
  await waitForDeviceConnected(device);

  // Step 6: Run configure handshake with retry logic.
  // configure() sends wantConfigId to the device, which triggers a full config
  // dump. The device sends configCompleteId when done, which fires
  // DeviceConfigured status. We MUST wait for this before sending admin
  // commands -- the config dump populates myNodeInfo.myNodeNum which is
  // required for proper packet addressing (sendPacket uses it for "self").
  const registrationInfo = await configureWithRetry(device);

  return { device, registrationInfo };
}

/** Port handed over by the manual "Select port" fallback button (a user
 *  gesture calling requestPortForReconnect). The native-USB poll loop picks
 *  it up on its next pass and treats it as authoritative. */
let manuallySelectedPort: SerialPort | null = null;

/**
 * Manual fallback for the native-USB reconnect: prompt the user to pick the
 * device's serial port. Needed when a power-cycle re-enumerates the device
 * under a USB identity the site has no stored permission for (getPorts()
 * never sees it). MUST be called from a user gesture (button click).
 */
export async function requestPortForReconnect(): Promise<void> {
  manuallySelectedPort = await navigator.serial.requestPort();
}

/**
 * Read and discard bytes from an OPEN port for windowMs, returning the byte
 * count. Used both to detect firmware boot text and to drain it (0x94 bytes
 * in boot text poison @meshtastic/core's framing parser — see call sites).
 */
async function readForWindow(port: SerialPort, windowMs: number): Promise<number> {
  const reader = port.readable!.getReader();
  let bytes = 0;
  const timeout = setTimeout(() => reader.cancel(), windowMs);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) bytes += value.length;
    }
  } catch {
    // reader.cancel() fires an error, expected
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  return bytes;
}

/**
 * Native-USB reconnect: poll fresh getPorts() enumerations until a port
 * produces output (firmware boot/debug text), prompting the user to
 * power-cycle the board if nothing is heard within a few seconds.
 *
 * Why polling: on ESP32-S3/C3/C6 native USB there is no bridge chip. The
 * DTR/RTS reset may be a no-op (T-Beam 1W), so only a manual power-cycle
 * boots the new firmware — and that re-enumerates USB, killing any held
 * SerialPort handle. Each pass re-enumerates so we always try live handles.
 *
 * Escape hatches:
 * - manuallySelectedPort (user gesture via requestPortForReconnect) is
 *   accepted immediately without requiring boot text.
 * - After NATIVE_USB_SILENT_FALLBACK_MS an openable-but-silent port is
 *   accepted and the Meshtastic handshake becomes the arbiter (an
 *   already-running firmware may emit nothing spontaneously).
 *
 * @returns a CLOSED SerialPort ready for TransportWebSerial.createFromPort
 */
async function waitForFirmwareBootNativeUsb(
  onAwaitingUserReset?: (waiting: boolean) => void
): Promise<SerialPort> {
  const start = Date.now();
  let prompted = false;
  console.log("[meshtastic] Native-USB board: polling for firmware boot text...");
  try {
    while (Date.now() - start < NATIVE_USB_BOOT_TIMEOUT_MS) {
      // Manual selection is authoritative — the user pointed at the device.
      const manual = manuallySelectedPort;
      if (manual) {
        manuallySelectedPort = null;
        try {
          if (!manual.readable && !manual.writable) {
            await manual.open({ baudRate: MESHTASTIC_BAUDRATE });
          }
          try { await manual.setSignals({ dataTerminalReady: true }); } catch { /* some stacks reject */ }
          const bytes = await readForWindow(manual, DRAIN_TIMEOUT_MS);
          await manual.close();
          console.log(`[meshtastic] Using manually selected port (drained ${bytes} bytes)`);
          return manual;
        } catch (err) {
          console.warn("[meshtastic] Manually selected port failed to open:", err);
          try { await manual.close(); } catch { /* ignore */ }
        }
      }

      const elapsed = Date.now() - start;
      if (!prompted && elapsed > NATIVE_USB_PROMPT_AFTER_MS) {
        prompted = true;
        console.log("[meshtastic] No firmware output yet -- prompting user to power-cycle");
        onAwaitingUserReset?.(true);
      }

      // Fresh enumeration every pass: a power-cycle re-enumerates USB and
      // invalidates old SerialPort objects, but the permission grant survives
      // for the same USB identity, so getPorts() returns a fresh live handle.
      const candidates = await navigator.serial.getPorts();
      for (const candidate of candidates) {
        if (candidate.readable || candidate.writable) continue; // already open elsewhere
        let opened = false;
        try {
          await candidate.open({ baudRate: MESHTASTIC_BAUDRATE });
          opened = true;
          try { await candidate.setSignals({ dataTerminalReady: true }); } catch { /* some stacks reject */ }
          const bytes = await readForWindow(candidate, NATIVE_USB_READ_WINDOW_MS);
          if (bytes > 0) {
            console.log(`[meshtastic] Firmware is talking (${bytes} bytes) -- draining boot text`);
            await readForWindow(candidate, DRAIN_TIMEOUT_MS);
            await candidate.close();
            return candidate;
          }
          if (elapsed > NATIVE_USB_SILENT_FALLBACK_MS) {
            console.log("[meshtastic] Port openable but silent -- attempting handshake anyway");
            await candidate.close();
            return candidate;
          }
          await candidate.close();
        } catch {
          // Stale pre-re-enumeration handle or transient open failure — keep polling.
          if (opened) { try { await candidate.close(); } catch { /* ignore */ } }
        }
      }
      await new Promise((r) => setTimeout(r, NATIVE_USB_POLL_GAP_MS));
    }
  } finally {
    if (prompted) onAwaitingUserReset?.(false);
  }
  throw new Error(
    "Timed out waiting for the device to boot the new firmware. Power-cycle the device (press RST, or switch it off and on), then click Retry."
  );
}

/**
 * Connect to an nRF52 (e.g. Seeed T-1000E) device over Web Serial for the
 * configure/register step.
 *
 * Unlike the ESP32 path, an nRF52 device is flashed via UF2 drag-and-drop
 * (mass-storage), which grants NO serial-port permission — so we cannot reuse
 * navigator.serial.getPorts(). After the UF2 write the device reboots straight
 * into the Meshtastic application firmware and enumerates as a fresh USB CDC
 * serial port, so we prompt for it with navigator.serial.requestPort() (this
 * runs from the Configure step's auto-start, inside the click that advanced
 * the wizard, so it is within a user gesture).
 *
 * There is NO esptool DTR/RTS "reset out of ROM bootloader" sequence and NO
 * ESP32-S3 USB-JTAG boot-text drain here: the device is already running
 * application firmware over a clean CDC link (both of those are esptool
 * artifacts that would be wrong for nRF52). Everything downstream —
 * waitForDeviceConnected, configureWithRetry, and the whole config-push /
 * auto-register pipeline in use-configure.ts — is transport-agnostic and
 * shared with the ESP32 path.
 *
 * @returns Connected and configured MeshDevice instance with registration info
 * @throws Error if the user cancels the port picker or the handshake times out
 */
export async function connectMeshtasticDeviceNrf52(): Promise<{
  device: MeshDevice;
  registrationInfo: DeviceRegistrationInfo;
}> {
  // Prompt for the newly-enumerated Meshtastic CDC serial port. The UF2
  // drop is a mass-storage action, so no prior grant exists to reuse.
  const port = await navigator.serial.requestPort();

  const transport = await TransportWebSerial.createFromPort(
    port,
    MESHTASTIC_BAUDRATE
  );

  // Assert DTR so CDC-ACM firmware starts streaming. Some CDC stacks reject
  // setSignals — it is non-fatal, the link works regardless.
  try {
    await port.setSignals({ dataTerminalReady: true });
  } catch (err) {
    console.warn("[meshtastic] nRF52 setSignals(DTR) not supported:", err);
  }

  const device = new MeshDevice(transport);

  // Same ordering as the ESP32 path: wait for the transport to reach
  // DeviceConnected before configure() so the wantConfigId packet isn't
  // dropped, then run the configure handshake (populates myNodeInfo).
  await waitForDeviceConnected(device);
  const registrationInfo = await configureWithRetry(device);

  return { device, registrationInfo };
}

/**
 * Push complete device configuration.
 *
 * Each admin write goes through awaitAckTolerant(): the packet is written to
 * the transport synchronously at call time (ordering preserved), and we wait
 * up to ADMIN_ACK_TIMEOUT_MS for the ACK. On ≤2.7 firmware every ACK arrives
 * fast and this behaves exactly like a plain await; on 2.8 develop the ACKs
 * are eaten by an upstream loopbackOk regression while the writes still
 * apply, so we proceed and rely on the post-commit read-back verification.
 * The settings transaction is opened EXPLICITLY up front — otherwise the
 * library's setConfig would internally `await beginEditSettings()` and stall
 * the whole push on ack-less firmware.
 *
 * Order: Radio (region FIRST) -> MQTT -> Channels -> Identity -> Commit
 * Region must be set first on a freshly flashed device -- the firmware
 * won't fully initialize without a valid region.
 *
 * @param device - Connected MeshDevice from connectMeshtasticDevice()
 * @param config - DeviceConfigPayload from /api/config
 * @param onStageComplete - Callback for progress tracking
 */
export async function pushDeviceConfig(
  device: MeshDevice,
  config: DeviceConfigPayload,
  onStageComplete: (stage: string, summary: string) => void
): Promise<void> {
  // 0. Open the settings transaction explicitly. The library flags the
  // pending transaction synchronously, so later setConfig calls skip their
  // internal `await beginEditSettings()` — which would never resolve on
  // ack-less 2.8 develop firmware. beginEditSettings is typed private in
  // @meshtastic/core 2.6.7 (setConfig is meant to auto-call it) but is a
  // plain runtime method; the cast only bypasses the typing, not behavior.
  await awaitAckTolerant(
    (
      device as unknown as { beginEditSettings(): Promise<unknown> }
    ).beginEditSettings(),
    "beginEditSettings"
  );

  // 1. Radio Config FIRST -- freshly flashed devices need region set before
  // the firmware fully initializes. Without a region, other config may be ignored.
  console.log("[meshtastic] Pushing radio config (region first)...");
  const regionCode = mapRegionCode(config.radio.region);
  const modemPreset = mapModemPreset(config.radio.modemPreset);

  const loraConfig = create(Protobuf.Config.ConfigSchema, {
    payloadVariant: {
      case: "lora" as const,
      value: create(Protobuf.Config.Config_LoRaConfigSchema, {
        region: regionCode,
        modemPreset: modemPreset,
        channelNum: config.radio.channelNum,
        hopLimit: config.radio.hopLimit,
        txEnabled: true,
        usePreset: true,
        configOkToMqtt: true,
      }),
    },
  });
  await awaitAckTolerant(device.setConfig(loraConfig), "setConfig(lora)");
  console.log("[meshtastic] Radio config applied");

  // 1b. Position Config (device Config) — enable GPS + smart broadcast so the
  // node actually emits position packets. Grouped into the radio stage: both are
  // device Config messages and region (set above) must precede other config on a
  // freshly flashed device. Per-channel positionPrecision (step 3) decides how
  // exact those broadcast coordinates are. Devices with no GPS chip simply emit
  // nothing here — harmless.
  console.log("[meshtastic] Pushing position config...");
  const positionConfig = create(Protobuf.Config.ConfigSchema, {
    payloadVariant: {
      case: "position" as const,
      value: create(Protobuf.Config.Config_PositionConfigSchema, {
        gpsMode: Protobuf.Config.Config_PositionConfig_GpsMode.ENABLED,
        positionBroadcastSecs: config.position.broadcastSecs,
        positionBroadcastSmartEnabled: config.position.smartEnabled,
        positionFlags:
          Protobuf.Config.Config_PositionConfig_PositionFlags.ALTITUDE |
          Protobuf.Config.Config_PositionConfig_PositionFlags.SPEED |
          Protobuf.Config.Config_PositionConfig_PositionFlags.HEADING,
      }),
    },
  });
  await awaitAckTolerant(device.setConfig(positionConfig), "setConfig(position)");
  console.log("[meshtastic] Position config applied");
  onStageComplete(
    "radio",
    `${config.radio.region} / ${config.radio.modemPreset} · slot ${config.radio.channelNum} · GPS on`
  );

  // 2. MQTT Config (ModuleConfig)
  console.log("[meshtastic] Pushing MQTT config...");
  // Explicit host:port — firmware and each phone app's client proxy fall back
  // to different implicit defaults on a bare hostname; writing the port (4433,
  // the firmware TLS default, which the NLB listens on) removes the ambiguity.
  const mqttAddress = formatMqttAddress(config.mqtt.server, config.mqtt.port);
  const mqttConfig = create(Protobuf.ModuleConfig.ModuleConfigSchema, {
    payloadVariant: {
      case: "mqtt" as const,
      value: create(Protobuf.ModuleConfig.ModuleConfig_MQTTConfigSchema, {
        enabled: true,
        address: mqttAddress,
        username: config.mqtt.username,
        password: config.mqtt.password,
        tlsEnabled: config.mqtt.tls,
        root: config.mqtt.root,
        encryptionEnabled: true,
        jsonEnabled: false,
        proxyToClientEnabled: true,
        // Force-provision map reporting here so the operator never has to accept
        // the in-app "share unencrypted node data via MQTT" consent gate — the
        // flasher writes the device state directly (there is no separate consent
        // field in firmware; the checkbox is purely an app-side UX gate).
        mapReportingEnabled: config.mapReport.enabled,
        mapReportSettings: create(
          Protobuf.ModuleConfig.ModuleConfig_MapReportSettingsSchema,
          {
            publishIntervalSecs: config.mapReport.publishIntervalSecs,
            positionPrecision: config.mapReport.positionPrecision,
            // Only include location in the (unencrypted, public) map report when
            // a non-zero precision is configured.
            shouldReportLocation: config.mapReport.positionPrecision > 0,
          }
        ),
      }),
    },
  });
  await awaitAckTolerant(device.setModuleConfig(mqttConfig), "setModuleConfig(mqtt)");
  console.log("[meshtastic] MQTT config applied");
  onStageComplete("mqtt", mqttAddress);

  // 3. Channel Config
  console.log("[meshtastic] Pushing channel config...");
  for (let i = 0; i < config.channels.length; i++) {
    const ch = config.channels[i];

    const pskBytes = decodeBase64Psk(ch.psk);
    const role =
      ch.role === "PRIMARY"
        ? Protobuf.Channel.Channel_Role.PRIMARY
        : Protobuf.Channel.Channel_Role.SECONDARY;

    const channel = create(Protobuf.Channel.ChannelSchema, {
      index: i,
      role,
      settings: create(Protobuf.Channel.ChannelSettingsSchema, {
        name: ch.name,
        psk: pskBytes,
        uplinkEnabled: true,
        downlinkEnabled: true,
        // Per-channel position precision. 0 = position sharing off on this
        // channel; 32 = exact GPS. dc.run (PRIMARY) is precise; the public
        // LongFast bridge is 0. Position packets themselves are gated by the
        // device Position module (step 1b).
        moduleSettings: create(Protobuf.Channel.ModuleSettingsSchema, {
          positionPrecision: ch.positionPrecision ?? 0,
        }),
      }),
    });
    await awaitAckTolerant(device.setChannel(channel), `setChannel(${i})`);
    console.log(`[meshtastic] Channel ${i} (${ch.name}) applied`);
  }
  onStageComplete("channels", `${config.channels.length} channels`);

  // 4. Identity Config
  console.log("[meshtastic] Pushing identity config...");
  // Byte-guard at the hardware boundary (server already clamps, but a stale or
  // hand-crafted payload must not reach the radio over-length): long_name over
  // 39 UTF-8 bytes fails nanopb decode on the device — the whole owner write is
  // silently dropped — and a shortName sliced by UTF-16 code units can exceed
  // the 4-byte limit and render as garbage.
  const owner = create(Protobuf.Mesh.UserSchema, {
    longName: clampLongName(config.identity.longName),
    shortName: buildShortName(config.identity.shortName),
  });
  await awaitAckTolerant(device.setOwner(owner), "setOwner");
  console.log("[meshtastic] Identity applied");
  onStageComplete("identity", config.identity.longName);

  // 4b. Ringtone (RTTTL) — set via AdminMessage on the ADMIN_APP port.
  // @meshtastic/core has no setRingtone() helper; mirror its setCannedMessages
  // pattern (AdminMessage → sendPacket to ADMIN_APP "self"). Sets the tune only;
  // enabling the External Notification buzzer module is out of scope.
  //
  // SAFETY: only ever write a VALID, non-empty RTTTL. resolveRingtone() already
  // guarantees a well-formed tune, but we re-check at this hardware boundary and
  // SKIP the push entirely rather than risk committing an empty/malformed tune
  // to the device ("valid value, or nothing" — a bad ringtone written here has
  // been implicated in post-config boot failures). The stage still completes so
  // the pipeline index stays in step with use-configure's `stages` array.
  if (isValidRtttl(config.ringtone)) {
    console.log("[meshtastic] Pushing ringtone...");
    const ringtoneBytes = buildRingtoneAdminMessageBytes(config.ringtone);
    await awaitAckTolerant(
      device.sendPacket(ringtoneBytes, Protobuf.Portnums.PortNum.ADMIN_APP, "self"),
      "sendPacket(ringtone)"
    );
    console.log("[meshtastic] Ringtone applied");
    onStageComplete("ringtone", "custom tune");
  } else {
    console.warn(
      `[meshtastic] Skipping ringtone — not a valid RTTTL: ${JSON.stringify(config.ringtone)}`
    );
    onStageComplete("ringtone", "skipped (no valid tune)");
  }

  // 5. Commit all changes atomically
  console.log("[meshtastic] Committing settings...");
  await awaitAckTolerant(device.commitEditSettings(), "commitEditSettings");
  console.log("[meshtastic] Settings committed");

  // 5b. Let the commit settle before reading anything back. Config can stage
  // without persisting (the orphaned-cred landmine), and some commits trigger
  // a reboot — reading back instantly can return staged RAM values that never
  // survive. A short settle makes the read-back more likely to reflect what
  // was actually persisted; if the device does reboot and drops serial, the
  // verifies below resolve inconclusive (fail-open) rather than hanging.
  await new Promise((resolve) => setTimeout(resolve, COMMIT_SETTLE_MS));

  // 6. Verify the LoRa region actually persisted. The flasher already sends US
  // correctly, but a device that silently DROPS the region on the post-commit
  // reboot (firmware/flash) would publish to a region-less MQTT topic
  // (msh/2/e/dc.run) invisible to the US fleet on msh/US/2/e/dc.run. Read it
  // back and HARD-FAIL the flash on a CONFIRMED mismatch so a broken node never
  // leaves the table. If the read-back is inconclusive (timeout/disconnect) we
  // warn but do NOT block — we can't tell good from bad and must never halt
  // flashing on an unread value.
  const region = await verifyRegion(device, mapRegionCode(config.radio.region));
  if (region.status === "mismatch") {
    throw new Error(
      `Radio region did not persist: device reports "${region.actualName}", expected "${config.radio.region}". ` +
        `A wrong region publishes to an MQTT topic the fleet can't see. Please retry / re-flash this device.`
    );
  }

  // 7. Verify the MQTT module config actually persisted — the guard for the
  // orphaned-cred failure: a radio whose MQTT push staged but never committed
  // keeps creds from an earlier provisioning and gets AUTH_REJECTed forever
  // (the phone app's client proxy presents whatever the RADIO stores, so this
  // is invisible until the broker denies it). Same fail-open contract as
  // region: hard-fail only on a positively read mismatch.
  const mqtt = await verifyMqttConfig(
    {
      events: device.events,
      getModuleConfig: (t) => device.getModuleConfig(t),
      // 2.8-develop fallback: the admin GET response is dropped upstream, but
      // re-requesting the wantConfig dump still streams module config.
      requestConfigDump: () => {
        device.configure().catch(() => {});
      },
    },
    {
      username: config.mqtt.username,
      address: mqttAddress,
      root: config.mqtt.root,
      enabled: true,
    }
  );
  if (mqtt.status === "mismatch") {
    console.error("[meshtastic] MQTT config MISMATCH:", mqtt.mismatches);
    throw new Error(
      `MQTT config did not persist (${mqtt.mismatches.join("; ")}). ` +
        `The radio would keep stale credentials and be rejected by the broker. Please retry configuration.`
    );
  }
  console.log(`[meshtastic] MQTT config ${mqtt.status}`);

  const verifiedParts = [
    region.status === "verified" ? `region ${config.radio.region} verified` : "region unverified",
    mqtt.status === "verified" ? "MQTT verified" : "MQTT unverified",
  ];
  onStageComplete("committing", `Settings saved · ${verifiedParts.join(" · ")}`);
}

/** Result of reading the device's LoRa region back after commit. */
type RegionVerifyResult =
  | { status: "verified" }
  | { status: "mismatch"; actualName: string }
  | { status: "inconclusive" };

/**
 * Read the device's LoRa region back and compare it to what we pushed.
 *
 * Mirrors requestSecurityKeys(): subscribe to onConfigPacket, actively request
 * LORA_CONFIG via getConfig(), and wait for the reply. Best-effort — a timeout
 * or a failed request resolves "inconclusive" (never blocks). Only a positively
 * read, non-matching region resolves "mismatch".
 */
async function verifyRegion(
  device: MeshDevice,
  expected: Protobuf.Config.Config_LoRaConfig_RegionCode
): Promise<RegionVerifyResult> {
  const TIMEOUT_MS = 10000;
  const regionName = (code: number): string =>
    Protobuf.Config.Config_LoRaConfig_RegionCode[code] ?? String(code);

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: RegionVerifyResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearTimeout(dumpFallback);
      unsub();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      console.warn(
        "[meshtastic] Region read-back timed out — leaving unverified (not blocking)"
      );
      finish({ status: "inconclusive" });
    }, TIMEOUT_MS);

    // 2.8 develop never answers the admin GET (loopbackOk regression drops
    // the response); re-requesting the wantConfig dump still streams the lora
    // config to the same subscriber. On ≤2.7 the GET answers first and this
    // timer is cleared without firing.
    const dumpFallback = setTimeout(() => {
      if (!resolved) {
        console.log(
          "[meshtastic] Region GET silent — falling back to config-dump re-request"
        );
        device.configure().catch(() => {});
      }
    }, 2500);

    const unsub = device.events.onConfigPacket.subscribe(
      (cfg: Protobuf.Config.Config) => {
        if (cfg.payloadVariant.case !== "lora") return;
        const actual = cfg.payloadVariant.value.region;
        if (actual === expected) {
          console.log(`[meshtastic] Region verified: ${regionName(actual)}`);
          finish({ status: "verified" });
        } else {
          console.error(
            `[meshtastic] Region MISMATCH: device reports ${regionName(actual)}, expected ${regionName(expected)}`
          );
          finish({ status: "mismatch", actualName: regionName(actual) });
        }
      }
    );

    device
      .getConfig(Protobuf.Admin.AdminMessage_ConfigType.LORA_CONFIG)
      .catch((err: unknown) => {
        // Not terminal: the dump fallback can still feed the subscriber; the
        // 10s overall timeout bounds the wait either way.
        console.warn(
          "[meshtastic] getConfig(LORA_CONFIG) request errored (tolerated):",
          err
        );
      });
  });
}

/**
 * Request the device's security config to capture X25519 keys.
 *
 * On a freshly flashed device, the security config captured during the
 * initial configure handshake may have empty keys — the device hasn't
 * generated its X25519 keypair yet at that point. After the full config
 * push (especially region), the device generates its keypair. This
 * function explicitly requests the security config to retrieve the
 * now-generated keys.
 *
 * @param device - Connected and configured MeshDevice
 * @returns Base64-encoded privateKey and publicKey (empty string if not available)
 */
export async function requestSecurityKeys(
  device: MeshDevice
): Promise<{ privateKey: string; publicKey: string }> {
  const TIMEOUT_MS = 10000;

  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        console.warn("[meshtastic] Timed out waiting for security config response");
        resolve({ privateKey: "", publicKey: "" });
      }
    }, TIMEOUT_MS);

    const unsub = device.events.onConfigPacket.subscribe(
      (cfg: Protobuf.Config.Config) => {
        if (cfg.payloadVariant.case === "security" && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsub();

          const pk = cfg.payloadVariant.value.privateKey;
          const pub = cfg.payloadVariant.value.publicKey;

          const privateKey =
            pk != null && pk.length > 0
              ? btoa(String.fromCharCode(...pk))
              : "";
          const publicKey =
            pub != null && pub.length > 0
              ? btoa(String.fromCharCode(...pub))
              : "";

          console.log(
            `[meshtastic] Security keys from getConfig: private=${privateKey ? "present" : "empty"}, public=${publicKey ? "present" : "empty"}`
          );
          resolve({ privateKey, publicKey });
        }
      }
    );

    device
      .getConfig(Protobuf.Admin.AdminMessage_ConfigType.SECURITY_CONFIG)
      .catch((err: unknown) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsub();
          console.warn("[meshtastic] getConfig(SECURITY_CONFIG) failed:", err);
          resolve({ privateKey: "", publicKey: "" });
        }
      });
  });
}

/**
 * Disconnect from a Meshtastic device.
 * Closes the transport and releases the serial port.
 */
export async function disconnectMeshtasticDevice(
  device: MeshDevice
): Promise<void> {
  try {
    await device.transport.disconnect();
  } catch (err) {
    // "Cannot cancel a locked stream" is expected if transport is still active
    console.warn("[meshtastic] Could not cleanly disconnect:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Configure device with retry logic.
 * Calls device.configure() and waits for DeviceConfigured status.
 * Retries up to MAX_CONFIGURE_RETRIES times if configure times out.
 *
 * The configure handshake is critical -- it:
 * 1. Sends wantConfigId to the device
 * 2. Device dumps its full current config (myInfo, nodeInfo, config, channels, etc.)
 * 3. Device sends configCompleteId when done
 * 4. Library fires DeviceConfigured status
 *
 * After this, myNodeInfo.myNodeNum is populated, which is required for
 * admin commands (sendPacket addresses packets to "self" using this number).
 */
async function configureWithRetry(device: MeshDevice): Promise<DeviceRegistrationInfo> {
  // Captured across retries -- events fire during configure() handshake.
  // Use object wrapper so TypeScript doesn't narrow to `never` inside closures.
  const captured: { nodeNum: number | null; privateKey: Uint8Array | null; publicKey: Uint8Array | null } = {
    nodeNum: null,
    privateKey: null,
    publicKey: null,
  };

  // Subscribe to device events BEFORE any configure() call so we catch
  // the config dump that happens during the handshake.
  const unsubNodeInfo = device.events.onMyNodeInfo.subscribe(
    (info: Protobuf.Mesh.MyNodeInfo) => {
      captured.nodeNum = info.myNodeNum;
      console.log(`[meshtastic] Captured myNodeNum: ${captured.nodeNum}`);
    }
  );

  const unsubConfig = device.events.onConfigPacket.subscribe(
    (cfg: Protobuf.Config.Config) => {
      if (cfg.payloadVariant.case === "security") {
        captured.privateKey = cfg.payloadVariant.value.privateKey;
        captured.publicKey = cfg.payloadVariant.value.publicKey;
        console.log("[meshtastic] Captured security privateKey + publicKey");
      }
    }
  );

  try {
    for (let attempt = 1; attempt <= MAX_CONFIGURE_RETRIES; attempt++) {
      try {
        console.log(`[meshtastic] configure() attempt ${attempt}/${MAX_CONFIGURE_RETRIES}`);

        // Set up the status listener BEFORE calling configure() to avoid
        // any race where DeviceConfigured fires before we're listening.
        const configurePromise = waitForDeviceReady(device);

        // Fire configure -- don't await it directly since the promise resolves
        // on queue ACK (or 60s queue timeout), not on DeviceConfigured.
        // We listen for the DeviceConfigured status event instead.
        device.configure().catch((err: unknown) => {
          console.warn("[meshtastic] configure() rejected:", err);
        });

        await configurePromise;
        console.log("[meshtastic] Device configured and ready for config push");

        // Build registration info from captured events
        let nodeId = "";
        let privateKey = "";

        if (captured.nodeNum != null) {
          nodeId = "!" + captured.nodeNum.toString(16).padStart(8, "0");
        } else {
          console.warn("[meshtastic] myNodeNum was not captured during configure");
        }

        if (captured.privateKey != null && captured.privateKey.length > 0) {
          privateKey = btoa(String.fromCharCode(...captured.privateKey));
        }

        let publicKey = "";
        if (captured.publicKey != null && captured.publicKey.length > 0) {
          publicKey = btoa(String.fromCharCode(...captured.publicKey));
        }

        return { nodeId, privateKey, publicKey };
      } catch (err) {
        console.error(`[meshtastic] configure() attempt ${attempt} failed:`, err);
        if (attempt === MAX_CONFIGURE_RETRIES) {
          throw new Error(
            `Device configuration failed after ${MAX_CONFIGURE_RETRIES} attempts. ` +
              `The device may need more time to boot. ${getMeshtasticErrorMessage(err)}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  } finally {
    unsubNodeInfo();
    unsubConfig();
  }

  // Unreachable but satisfies TypeScript
  return { nodeId: "", privateKey: "", publicKey: "" };
}

/**
 * Wait for the device to reach DeviceConfigured status.
 * Listens for onDeviceStatus events after configure() is called.
 * Resolves when DeviceConfigured fires.
 * Rejects after CONFIGURE_TIMEOUT_MS if DeviceConfigured is never received.
 */
function waitForDeviceReady(device: MeshDevice): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let statusCount = 0;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        reject(new Error(
          `Timed out waiting for DeviceConfigured after ${CONFIGURE_TIMEOUT_MS / 1000}s. ` +
          `Got ${statusCount} status events. The device may need a reboot.`
        ));
      }
    }, CONFIGURE_TIMEOUT_MS);

    const unsub = device.events.onDeviceStatus.subscribe((status: number) => {
      statusCount++;
      const statusName = Object.entries(Types.DeviceStatusEnum)
        .find(([, v]) => v === status)?.[0] || "unknown";
      console.log(
        `[meshtastic] DeviceStatus #${statusCount}: ${status} (${statusName}) -- waiting for ${Types.DeviceStatusEnum.DeviceConfigured} (DeviceConfigured)`
      );

      if (status === Types.DeviceStatusEnum.DeviceConfigured) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsub();
          console.log("[meshtastic] DeviceConfigured received -- device is ready for config push");
          resolve();
        }
      }
    });
  });
}

/**
 * Wait for the transport to reach DeviceConnected status.
 * TransportWebSerial connects asynchronously after construction --
 * we must wait for it before sending any packets.
 * Resolves immediately if device is already connected or configured.
 */
function waitForDeviceConnected(device: MeshDevice): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        reject(new Error("Timed out waiting for transport to connect (10s)"));
      }
    }, 10000);

    const unsub = device.events.onDeviceStatus.subscribe((status: number) => {
      if (status >= Types.DeviceStatusEnum.DeviceConnected && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        unsub();
        console.log("[meshtastic] Transport connected -- ready to configure");
        resolve();
      }
    });
  });
}

/**
 * Decode a base64-encoded PSK string to Uint8Array.
 * Validates that the resulting byte length is 0, 16, or 32.
 *
 * @param pskBase64 - Base64-encoded PSK string
 * @returns Decoded PSK as Uint8Array
 * @throws Error if PSK byte length is invalid
 */
function decodeBase64Psk(pskBase64: string): Uint8Array {
  if (!pskBase64 || pskBase64.length === 0) {
    return new Uint8Array(0);
  }

  const binary = atob(pskBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Meshtastic accepts 0 (none), 1 (simple/default key shorthand), 16, or 32 bytes
  if (![0, 1, 16, 32].includes(bytes.length)) {
    throw new Error(
      `Invalid PSK length: ${bytes.length} bytes. Must be 0, 1, 16, or 32 bytes.`
    );
  }

  return bytes;
}

/**
 * Map a region string (e.g., "US") to the protobuf RegionCode enum value.
 */
function mapRegionCode(
  region: string
): Protobuf.Config.Config_LoRaConfig_RegionCode {
  const map: Record<string, Protobuf.Config.Config_LoRaConfig_RegionCode> = {
    UNSET: Protobuf.Config.Config_LoRaConfig_RegionCode.UNSET,
    US: Protobuf.Config.Config_LoRaConfig_RegionCode.US,
    EU_433: Protobuf.Config.Config_LoRaConfig_RegionCode.EU_433,
    EU_868: Protobuf.Config.Config_LoRaConfig_RegionCode.EU_868,
    CN: Protobuf.Config.Config_LoRaConfig_RegionCode.CN,
    JP: Protobuf.Config.Config_LoRaConfig_RegionCode.JP,
    ANZ: Protobuf.Config.Config_LoRaConfig_RegionCode.ANZ,
    KR: Protobuf.Config.Config_LoRaConfig_RegionCode.KR,
    TW: Protobuf.Config.Config_LoRaConfig_RegionCode.TW,
    RU: Protobuf.Config.Config_LoRaConfig_RegionCode.RU,
    IN: Protobuf.Config.Config_LoRaConfig_RegionCode.IN,
    NZ_865: Protobuf.Config.Config_LoRaConfig_RegionCode.NZ_865,
    TH: Protobuf.Config.Config_LoRaConfig_RegionCode.TH,
    LORA_24: Protobuf.Config.Config_LoRaConfig_RegionCode.LORA_24,
    UA_433: Protobuf.Config.Config_LoRaConfig_RegionCode.UA_433,
    UA_868: Protobuf.Config.Config_LoRaConfig_RegionCode.UA_868,
    MY_433: Protobuf.Config.Config_LoRaConfig_RegionCode.MY_433,
    MY_919: Protobuf.Config.Config_LoRaConfig_RegionCode.MY_919,
    SG_923: Protobuf.Config.Config_LoRaConfig_RegionCode.SG_923,
    PH_433: Protobuf.Config.Config_LoRaConfig_RegionCode.PH_433,
    PH_868: Protobuf.Config.Config_LoRaConfig_RegionCode.PH_868,
    PH_915: Protobuf.Config.Config_LoRaConfig_RegionCode.PH_915,
  };

  const code = map[region];
  if (code === undefined) {
    throw new Error(
      `Unknown radio region: "${region}". Valid values: ${Object.keys(map).join(", ")}`
    );
  }
  return code;
}

/**
 * Map a modem preset string (e.g., "LONG_FAST") to the protobuf ModemPreset enum value.
 */
function mapModemPreset(
  preset: string
): Protobuf.Config.Config_LoRaConfig_ModemPreset {
  const map: Record<string, Protobuf.Config.Config_LoRaConfig_ModemPreset> = {
    LONG_FAST: Protobuf.Config.Config_LoRaConfig_ModemPreset.LONG_FAST,
    LONG_SLOW: Protobuf.Config.Config_LoRaConfig_ModemPreset.LONG_SLOW,
    VERY_LONG_SLOW:
      Protobuf.Config.Config_LoRaConfig_ModemPreset.VERY_LONG_SLOW,
    MEDIUM_SLOW: Protobuf.Config.Config_LoRaConfig_ModemPreset.MEDIUM_SLOW,
    MEDIUM_FAST: Protobuf.Config.Config_LoRaConfig_ModemPreset.MEDIUM_FAST,
    SHORT_SLOW: Protobuf.Config.Config_LoRaConfig_ModemPreset.SHORT_SLOW,
    SHORT_FAST: Protobuf.Config.Config_LoRaConfig_ModemPreset.SHORT_FAST,
    LONG_MODERATE:
      Protobuf.Config.Config_LoRaConfig_ModemPreset.LONG_MODERATE,
    SHORT_TURBO: Protobuf.Config.Config_LoRaConfig_ModemPreset.SHORT_TURBO,
  };

  const value = map[preset];
  if (value === undefined) {
    throw new Error(
      `Unknown modem preset: "${preset}". Valid values: ${Object.keys(map).join(", ")}`
    );
  }
  return value;
}

/**
 * Get a human-friendly error message for Meshtastic connection errors.
 */
function getMeshtasticErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Stream not accessible")) {
    return "Serial port streams not available. The device may need to be reconnected.";
  }
  if (message.includes("timeout") || message.includes("Timeout")) {
    return "Device did not respond. It may still be rebooting after flash.";
  }
  if (message.includes("connection lost")) {
    return "Lost connection to device during configuration.";
  }

  return message;
}
