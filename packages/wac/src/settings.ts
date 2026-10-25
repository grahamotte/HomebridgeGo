export const PLATFORM_NAME = "GoWacFans";
export const PLUGIN_NAME = "homebridge-go-wac-fans";

export const BONJOUR_TYPE = "easylink";

// Fans can take several seconds to wake their Wi-Fi after idling, so timeouts are generous.
export interface Timing {
  readonly discoveryIntervalMs: number;
  readonly discoveryTimeoutMs: number;
  readonly sweepIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly cacheTtlMs: number;
}

export const DEFAULT_TIMING: Timing = {
  discoveryIntervalMs: 300000,
  discoveryTimeoutMs: 8000,
  sweepIntervalMs: 1800000,
  requestTimeoutMs: 15000,
  pollIntervalMs: 30000,
  cacheTtlMs: 5000
};
