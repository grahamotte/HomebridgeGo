export const PLATFORM_NAME = "GoLutron";
export const PLUGIN_NAME = "homebridge-go-lutron";

export const LEAP_PORT = 8081;
export const PAIRING_PORT = 8083;
export const STORAGE_DIRECTORY = "go-lutron";

export interface Timing {
  readonly discoveryIntervalMs: number;
  readonly discoveryTimeoutMs: number;
  readonly pairingTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly pingIntervalMs: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
  readonly longPressMs: number;
  readonly doublePressMs: number;
}

export type BridgeTiming = Pick<Timing, "requestTimeoutMs" | "pingIntervalMs" | "reconnectMinMs" | "reconnectMaxMs">;

export const DEFAULT_TIMING: Timing = {
  discoveryIntervalMs: 300000,
  discoveryTimeoutMs: 5000,
  pairingTimeoutMs: 180000,
  requestTimeoutMs: 10000,
  pingIntervalMs: 60000,
  reconnectMinMs: 1000,
  reconnectMaxMs: 60000,
  longPressMs: 600,
  doublePressMs: 400
};
