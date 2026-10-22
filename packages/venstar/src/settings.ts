/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = "GoVenstar";

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = "homebridge-go-venstar";

// Thermostats can be slow to answer on busy Wi-Fi, so timeouts are generous.
export const DISCOVERY_TIMEOUT_MS = 10000;
export const REQUEST_TIMEOUT_MS = 15000;
export const POLL_INTERVAL_MS = 30000;
