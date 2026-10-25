export const PLATFORM_NAME = "GoVenstar";
export const PLUGIN_NAME = "homebridge-go-venstar";

export const SSDP_SEARCH_TARGET = "venstar:thermostat:ecp";

// Thermostats can be slow to answer on busy Wi-Fi, so timeouts are generous.
export interface Timing {
  readonly discoveryIntervalMs: number;
  readonly discoveryTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly cacheTtlMs: number;
  readonly settleMs: number;
}

export const DEFAULT_TIMING: Timing = {
  discoveryIntervalMs: 300000,
  discoveryTimeoutMs: 10000,
  requestTimeoutMs: 15000,
  pollIntervalMs: 30000,
  cacheTtlMs: 5000,
  settleMs: 250
};
