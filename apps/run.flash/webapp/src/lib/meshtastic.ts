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

/** Default baud rate for Meshtastic serial communication */
const MESHTASTIC_BAUDRATE = 115200;

/** Post-flash reboot delay in milliseconds */
const REBOOT_DELAY_MS = 4000;

/** Retry delay between connection attempts in milliseconds */
const RETRY_DELAY_MS = 2000;

/** Maximum number of configure() retry attempts */
const MAX_CONFIGURE_RETRIES = 3;

/** Timeout for waiting for DeviceConfigured status (ms) */
const CONFIGURE_TIMEOUT_MS = 15000;

/**
 * Connect to a Meshtastic device over Web Serial after flash reboot.
 *
 * Uses navigator.serial.getPorts() to reuse the already-granted port
 * (no user gesture needed -- permission was granted during connect step).
 *
 * Includes retry logic for post-flash reboot delay:
 * - 4 second initial delay for device boot
 * - Retry configure() up to 3 times with 2s delay between attempts
 * - 15 second timeout waiting for DeviceConfigured status
 *
 * @returns Connected and configured MeshDevice instance
 * @throws Error if connection times out or no port available
 */
export async function connectMeshtasticDevice(): Promise<MeshDevice> {
  // Step 1: Wait for device to reboot after flash
  await new Promise((resolve) => setTimeout(resolve, REBOOT_DELAY_MS));

  // Step 2: Get the previously-granted serial port
  const ports = await navigator.serial.getPorts();
  if (ports.length === 0) {
    throw new Error(
      "No serial port available. The device may have disconnected during reboot."
    );
  }
  const port = ports[0];

  // Step 3: Create TransportWebSerial from existing port
  const transport = await TransportWebSerial.createFromPort(
    port,
    MESHTASTIC_BAUDRATE
  );

  // Step 4: Create MeshDevice with transport
  // Constructor auto-pipes transport.fromDevice to the packet decoder
  const device = new MeshDevice(transport);

  // Step 5: Configure (handshake -- sends wantConfigId, waits for device config dump)
  // With retry logic: try configure, if timeout retry up to MAX_CONFIGURE_RETRIES
  await configureWithRetry(device);

  return device;
}

/**
 * Push complete device configuration.
 * Uses transactional edit: setConfig auto-calls beginEditSettings,
 * commitEditSettings finalizes all changes atomically.
 *
 * Order: MQTT -> Channels -> Identity -> Radio -> Commit
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
  // 1. MQTT Config (ModuleConfig -- MQTT is under ModuleConfig, not Config)
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
        encryptionEnabled: false,
        jsonEnabled: false,
        proxyToClientEnabled: false,
      }),
    },
  });
  await device.setModuleConfig(mqttConfig);
  onStageComplete("mqtt", config.mqtt.server);

  // 2. Channel Config
  for (let i = 0; i < config.channels.length; i++) {
    const ch = config.channels[i];

    // Decode PSK from base64 to Uint8Array
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
      }),
    });
    await device.setChannel(channel);
  }
  onStageComplete("channels", `${config.channels.length} channels`);

  // 3. Identity Config
  const owner = create(Protobuf.Mesh.UserSchema, {
    longName: config.identity.longName,
    shortName: config.identity.shortName.slice(0, 4).toUpperCase(),
  });
  await device.setOwner(owner);
  onStageComplete("identity", config.identity.longName);

  // 4. Radio Config (LoRa Config -- this IS a Config, not ModuleConfig)
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
      }),
    },
  });
  await device.setConfig(loraConfig);
  onStageComplete("radio", `${config.radio.region} / ${config.radio.modemPreset}`);

  // 5. Commit all changes atomically
  await device.commitEditSettings();
  onStageComplete("committing", "Settings saved");
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
  } catch {
    // Ignore disconnect errors -- port may already be closed
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Configure device with retry logic.
 * Calls device.configure() and waits for DeviceConfigured status.
 * Retries up to MAX_CONFIGURE_RETRIES times if configure times out.
 */
async function configureWithRetry(device: MeshDevice): Promise<void> {
  for (let attempt = 1; attempt <= MAX_CONFIGURE_RETRIES; attempt++) {
    try {
      await device.configure();
      await waitForConfigured(device);
      return;
    } catch (err) {
      if (attempt === MAX_CONFIGURE_RETRIES) {
        throw new Error(
          `Device configuration failed after ${MAX_CONFIGURE_RETRIES} attempts. ` +
            `The device may need more time to boot. ${getMeshtasticErrorMessage(err)}`
        );
      }
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/**
 * Wait for the device to reach DeviceConfigured status.
 * Returns a promise that resolves when status changes to DeviceConfigured,
 * or rejects on timeout.
 */
function waitForConfigured(device: MeshDevice): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error("Timed out waiting for device configuration handshake"));
    }, CONFIGURE_TIMEOUT_MS);

    const unsub = device.events.onDeviceStatus.subscribe((status: Types.DeviceStatusEnum) => {
      if (status === Types.DeviceStatusEnum.DeviceConfigured) {
        clearTimeout(timeout);
        unsub();
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

  if (bytes.length !== 0 && bytes.length !== 16 && bytes.length !== 32) {
    throw new Error(
      `Invalid PSK length: ${bytes.length} bytes. Must be 0, 16, or 32 bytes.`
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
