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
export async function connectMeshtasticDevice(): Promise<{
  device: MeshDevice;
  registrationInfo: DeviceRegistrationInfo;
}> {
  // Step 1: Get the previously-granted serial port
  const ports = await navigator.serial.getPorts();
  if (ports.length === 0) {
    throw new Error(
      "No serial port available. The device may have disconnected during reboot."
    );
  }
  const port = ports[0];

  // Step 2: Hard-reset the device out of bootloader mode.
  // The Connect step uses ESPLoader.main() which puts the device into ROM
  // bootloader mode. esptool's disconnect() already closed the port, so
  // we must reopen it briefly to toggle DTR/RTS and trigger a hardware
  // reset via the auto-reset circuitry.
  console.log("[meshtastic] Resetting device out of bootloader mode...");
  try {
    // Open the port if not already open (esptool closed it)
    if (!port.readable || !port.writable) {
      await port.open({ baudRate: MESHTASTIC_BAUDRATE });
    }
    // Reset-to-application sequence:
    // RTS=true pulls EN LOW (reset), DTR=false keeps GPIO0 HIGH (no bootloader)
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((r) => setTimeout(r, 100));
    // Release EN — device boots into application firmware
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await new Promise((r) => setTimeout(r, 50));
    console.log("[meshtastic] DTR/RTS reset sequence sent");
    // Close the port so we can reopen cleanly for Meshtastic
    await port.close();
  } catch (err) {
    console.warn("[meshtastic] Reset via setSignals failed:", err);
    // If port is still open, close it
    try { if (port.readable || port.writable) await port.close(); } catch { /* ignore */ }
  }

  // Step 3: Wait for the device to boot Meshtastic firmware.
  console.log(`[meshtastic] Waiting ${REBOOT_DELAY_MS}ms for device to boot firmware...`);
  await new Promise((resolve) => setTimeout(resolve, REBOOT_DELAY_MS));

  // Step 4: Drain boot/debug text from serial buffer.
  // ESP32-S3 USB-JTAG sends a burst of boot messages and debug text when
  // DTR is asserted. This text contains 0x94 bytes (from ASCII like
  // "ESP-ROM:esp32s3...") that poison @meshtastic/core's fromDeviceStream
  // parser — it finds the false 0x94, checks if the next byte is 0xC3,
  // it's not, and the parser stops processing forever (never recovers
  // from a false framing byte match). We must drain this text before
  // creating the MeshDevice.
  console.log("[meshtastic] Draining boot/debug text from serial buffer...");
  await port.open({ baudRate: MESHTASTIC_BAUDRATE });
  await port.setSignals({ dataTerminalReady: true });

  const reader = port.readable!.getReader();
  let drainedBytes = 0;
  const drainTimeout = setTimeout(() => reader.cancel(), DRAIN_TIMEOUT_MS);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) drainedBytes += value.length;
    }
  } catch {
    // reader.cancel() fires an error, expected
  } finally {
    clearTimeout(drainTimeout);
    reader.releaseLock();
  }
  console.log(`[meshtastic] Drained ${drainedBytes} bytes of boot text`);
  await port.close();

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
 * Each admin call is awaited directly -- the @meshtastic/core library handles
 * the internal sequencing (setConfig auto-calls beginEditSettings, packets are
 * queued and sent in order, ACKs are awaited). Wrapping these in artificial
 * timeouts would race past the library's internal await chains, scrambling
 * the packet order and causing config to not be applied.
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
  // 1. Radio Config FIRST -- freshly flashed devices need region set before
  // the firmware fully initializes. Without a region, other config may be ignored.
  // NOTE: setConfig() auto-calls beginEditSettings() if not already pending.
  console.log("[meshtastic] Pushing radio config (region first)...");
  const regionCode = mapRegionCode(config.radio.region);
  const modemPreset = mapModemPreset(config.radio.modemPreset);

  const loraConfig = create(Protobuf.Config.ConfigSchema, {
    payloadVariant: {
      case: "lora" as const,
      value: create(Protobuf.Config.Config_LoRaConfigSchema, {
        region: regionCode,
        modemPreset: modemPreset,
        hopLimit: config.radio.hopLimit,
        txEnabled: true,
        usePreset: true,
        configOkToMqtt: true,
      }),
    },
  });
  await device.setConfig(loraConfig);
  console.log("[meshtastic] Radio config applied");
  onStageComplete("radio", `${config.radio.region} / ${config.radio.modemPreset}`);

  // 2. MQTT Config (ModuleConfig)
  console.log("[meshtastic] Pushing MQTT config...");
  const mqttConfig = create(Protobuf.ModuleConfig.ModuleConfigSchema, {
    payloadVariant: {
      case: "mqtt" as const,
      value: create(Protobuf.ModuleConfig.ModuleConfig_MQTTConfigSchema, {
        enabled: true,
        address: config.mqtt.server,
        username: config.mqtt.username,
        password: config.mqtt.password,
        tlsEnabled: config.mqtt.tls,
        root: config.mqtt.root,
        encryptionEnabled: true,
        jsonEnabled: false,
        proxyToClientEnabled: true,
        mapReportingEnabled: true,
      }),
    },
  });
  await device.setModuleConfig(mqttConfig);
  console.log("[meshtastic] MQTT config applied");
  onStageComplete("mqtt", config.mqtt.server);

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
      }),
    });
    await device.setChannel(channel);
    console.log(`[meshtastic] Channel ${i} (${ch.name}) applied`);
  }
  onStageComplete("channels", `${config.channels.length} channels`);

  // 4. Identity Config
  console.log("[meshtastic] Pushing identity config...");
  const owner = create(Protobuf.Mesh.UserSchema, {
    longName: config.identity.longName,
    shortName: config.identity.shortName.slice(0, 4).toUpperCase(),
  });
  await device.setOwner(owner);
  console.log("[meshtastic] Identity applied");
  onStageComplete("identity", config.identity.longName);

  // 4b. Ringtone (RTTTL) — set via AdminMessage on the ADMIN_APP port.
  // @meshtastic/core has no setRingtone() helper; mirror its setCannedMessages
  // pattern (AdminMessage → sendPacket to ADMIN_APP "self"). Sets the tune only;
  // enabling the External Notification buzzer module is out of scope.
  console.log("[meshtastic] Pushing ringtone...");
  const ringtoneBytes = buildRingtoneAdminMessageBytes(config.ringtone);
  await device.sendPacket(
    ringtoneBytes,
    Protobuf.Portnums.PortNum.ADMIN_APP,
    "self"
  );
  console.log("[meshtastic] Ringtone applied");
  onStageComplete("ringtone", "custom tune");

  // 5. Commit all changes atomically
  console.log("[meshtastic] Committing settings...");
  await device.commitEditSettings();
  console.log("[meshtastic] Settings committed");
  onStageComplete("committing", "Settings saved");
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
