/** Config payload returned by GET /api/config */
export interface DeviceConfigPayload {
  mqtt: MqttConfig;
  channels: ChannelConfig[];
  identity: IdentityConfig;
  radio: RadioConfig;
  ringtone: string; // RTTTL tune (resolved: per-user override or class default)
}

export interface MqttConfig {
  server: string;
  port: number;
  username: string; // Per-user from RunUser entity
  password: string; // Per-user from RunUser entity
  tls: boolean;
  root: string; // MQTT topic root (e.g., "dcr34")
}

export interface ChannelConfig {
  name: string;
  psk: string; // Base64-encoded PSK (16 or 32 bytes)
  role: "PRIMARY" | "SECONDARY";
}

export interface IdentityConfig {
  longName: string; // e.g., "rabbit_abc1"
  shortName: string; // 4 chars max, e.g., "RABB"
}

export interface RadioConfig {
  region: string; // e.g., "US"
  modemPreset: string; // e.g., "LONG_FAST"
  hopLimit: number; // e.g., 3
}

/** Config push stage names (4 stages per CONTEXT.md) */
export type ConfigStage =
  | "idle"
  | "connecting" // Reconnecting to device post-flash
  | "mqtt" // Pushing MQTT config
  | "channels" // Pushing channel config
  | "identity" // Pushing identity config
  | "ringtone" // Pushing RTTTL ringtone
  | "radio" // Pushing radio config
  | "committing" // commitEditSettings
  | "complete"
  | "error";

/** Progress state for the config push pipeline */
export interface ConfigProgress {
  stage: ConfigStage;
  /** Completed stages (for pipeline checkmarks) */
  completedStages: ConfigStage[];
  /** Summary text for each completed stage (e.g., "mqtt.defcon.run") */
  stageSummaries: Partial<Record<ConfigStage, string>>;
  /** Error message if stage is "error" */
  error: string | null;
}

/** Initial config progress state */
export const INITIAL_CONFIG_PROGRESS: ConfigProgress = {
  stage: "idle",
  completedStages: [],
  stageSummaries: {},
  error: null,
} as const;
