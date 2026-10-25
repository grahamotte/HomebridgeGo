export const PLATFORM_NAME = "GoYale";
export const PLUGIN_NAME = "homebridge-go-yale";

export const LOW_BATTERY_PERCENT = 20;

export interface Timing {
  readonly discoveryTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly connectAttempts: number;
  readonly responseTimeoutMs: number;
  readonly ackTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly cooldownMs: number;
  readonly idleDisconnectMs: number;
}

export const DEFAULT_TIMING: Timing = {
  discoveryTimeoutMs: 30000,
  connectTimeoutMs: 120000,
  connectAttempts: 4,
  responseTimeoutMs: 10000,
  ackTimeoutMs: 8000,
  operationTimeoutMs: 12000,
  cooldownMs: 250,
  idleDisconnectMs: 30000
};
