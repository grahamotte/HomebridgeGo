import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from "homebridge";
import { ThermostatAccessory } from "./accessory.js";
import { parseConfig, type Settings } from "./config.js";
import { hostnameOnly, probeThermostats, searchSsdp, type SsdpSearch, type Thermostat } from "./discovery.js";
import { describe } from "./log.js";
import { AccessoryRegistry } from "./registry.js";
import { DEFAULT_TIMING, PLATFORM_NAME, PLUGIN_NAME, SSDP_SEARCH_TARGET, type Timing } from "./settings.js";

interface Context {
  device?: Thermostat;
}

export interface PlatformDependencies {
  readonly search?: SsdpSearch;
  readonly timing?: Partial<Timing>;
}

export class GoVenstarPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly settings: Settings;
  private readonly registry: AccessoryRegistry;
  private readonly controllers = new Map<string, ThermostatAccessory>();
  private readonly timing: Timing;
  private refreshing?: Promise<void>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private reportedSearchFailure = false;
  private reportedMissing = false;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
    private readonly dependencies: PlatformDependencies = {},
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.timing = { ...DEFAULT_TIMING, ...dependencies.timing };
    this.registry = new AccessoryRegistry(api, log, PLUGIN_NAME, PLATFORM_NAME);
    const { settings, problems } = parseConfig(config);
    this.settings = settings;
    for (const problem of problems) {
      this.log.error(problem);
    }

    api.on("didFinishLaunching", () => this.start());
    api.on("shutdown", () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.registry.configure(accessory);
  }

  start(): void {
    // Cached thermostats answer HomeKit straight away; discovery then updates their addresses.
    for (const accessory of this.registry.all()) {
      const device = (accessory.context as Context).device;
      if (device) {
        this.attach(accessory, device);
      }
    }

    this.refresh().catch(() => undefined);
    this.refreshTimer = setInterval(() => {
      this.refresh().catch(() => undefined);
    }, this.timing.discoveryIntervalMs);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const controller of this.controllers.values()) {
      controller.stop();
    }

    this.controllers.clear();
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.discover()
      .catch((error: unknown) => {
        this.log.error(`Thermostat discovery failed: ${describe(error)}`);
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private async discover(): Promise<void> {
    const search = this.dependencies.search ?? searchSsdp;
    const responses = await search(SSDP_SEARCH_TARGET, this.timing.discoveryTimeoutMs).then((devices) => {
      this.reportedSearchFailure = false;
      return devices;
    }, (error: unknown) => {
      this.log[this.reportedSearchFailure ? "debug" : "warn"](`SSDP discovery failed: ${describe(error)}`);
      this.reportedSearchFailure = true;
      return [];
    });
    const found = await probeThermostats(responses, this.settings.hosts, this.timing.requestTimeoutMs, this.log);
    if (this.stopped) {
      return;
    }

    for (const thermostat of found) {
      this.sync(thermostat);
    }

    const missing = found.length === 0 && this.registry.all().length === 0;
    if (missing && !this.reportedMissing) {
      this.log.warn("No Venstar thermostat found. Check that local API access is on, or set hosts if SSDP is blocked on this network.");
    }

    this.reportedMissing = missing;
  }

  private sync(found: Thermostat): void {
    const accessory = this.findCached(found) ?? this.registry.obtain(this.registry.uuid(found.id), found.name);
    const context = accessory.context as Context;
    const previous = context.device;
    // A thermostat found only by address keeps the identity it was first saved with.
    const device = previous && !found.id.startsWith("ssdp:") ? { ...found, id: previous.id, serialNumber: previous.serialNumber } : found;
    context.device = device;
    if (previous && previous.host !== device.host) {
      this.log.info(`${device.name} moved from ${previous.host} to ${device.host}.`);
    }

    this.attach(accessory, device);
    this.registry.publish(accessory, `thermostat ${device.name} at ${device.host}`);
  }

  private attach(accessory: PlatformAccessory, device: Thermostat): void {
    const controller = this.controllers.get(accessory.UUID);
    if (controller) {
      controller.update(device);
    } else {
      this.controllers.set(accessory.UUID, new ThermostatAccessory(this, accessory, device, this.timing));
    }
  }

  // Finds a cached accessory for a thermostat, including ones saved under the UUIDs older versions generated.
  private findCached(found: Thermostat): PlatformAccessory | undefined {
    const uuids = [found.id, hostnameOnly(found.host), `host:${found.host}`].map((id) => this.registry.uuid(id));
    for (const uuid of uuids) {
      const accessory = this.registry.get(uuid);
      if (accessory) {
        return accessory;
      }
    }

    return this.registry.all().find((accessory) => {
      const device = (accessory.context as Context).device;
      return device?.id === found.id || device?.host === found.host;
    });
  }
}
