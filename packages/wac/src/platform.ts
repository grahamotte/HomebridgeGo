import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from "homebridge";
import { FanAccessory } from "./accessory.js";
import { parseConfig, type Settings } from "./config.js";
import { browseFans, probeFans, subnetHosts, type Browse, type Fan } from "./discovery.js";
import { describe } from "./log.js";
import { AccessoryRegistry } from "./registry.js";
import { DEFAULT_TIMING, PLATFORM_NAME, PLUGIN_NAME, type Timing } from "./settings.js";

interface Context {
  device?: Fan;
}

export interface PlatformDependencies {
  readonly browse?: Browse;
  readonly subnet?: () => string[];
  readonly timing?: Partial<Timing>;
}

export class GoWacFansPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly settings: Settings;
  private readonly registry: AccessoryRegistry;
  private readonly controllers = new Map<string, FanAccessory>();
  private readonly timing: Timing;
  private refreshing?: Promise<void>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private sweptAt = -Infinity;
  private stopped = false;
  private reportedBrowseFailure = false;
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
    // Cached fans answer HomeKit straight away; discovery then updates their addresses.
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
        this.log.error(`Fan discovery failed: ${describe(error)}`);
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private async discover(): Promise<void> {
    const browse = this.dependencies.browse ?? browseFans;
    const advertised = await browse(this.timing.discoveryTimeoutMs).then((hosts) => {
      this.reportedBrowseFailure = false;
      return hosts;
    }, (error: unknown) => {
      this.log[this.reportedBrowseFailure ? "debug" : "warn"](`Bonjour discovery failed: ${describe(error)}`);
      this.reportedBrowseFailure = true;
      return [];
    });
    const cached = this.cachedFans();
    const found = await probeFans([...advertised, ...this.settings.hosts, ...cached.map((fan) => fan.host)], this.timing.discoveryTimeoutMs);

    // Bonjour is unreliable on some networks, so when a known fan is missing, or none is known yet,
    // probe every local address. The sweep is slow, so it runs at most once per sweep interval.
    const missing = cached.filter((fan) => !found.some((candidate) => candidate.clientId === fan.clientId));
    const now = Date.now();
    if ((missing.length > 0 || (cached.length === 0 && found.length === 0)) && now - this.sweptAt >= this.timing.sweepIntervalMs) {
      this.sweptAt = now;
      const hosts = (this.dependencies.subnet ?? subnetHosts)();
      this.log.debug(`Probing ${hosts.length} local addresses for fans.`);
      for (const fan of await probeFans(hosts, this.timing.discoveryTimeoutMs)) {
        if (!found.some((candidate) => candidate.clientId === fan.clientId)) {
          found.push(fan);
        }
      }
    }

    if (this.stopped) {
      return;
    }

    for (const fan of found) {
      this.sync(fan);
    }

    const none = found.length === 0 && this.registry.all().length === 0;
    if (none && !this.reportedMissing) {
      this.log.warn("No WAC fan found. Set hosts if the fans are on another network.");
    }

    this.reportedMissing = none;
  }

  private cachedFans(): Fan[] {
    return this.registry.all().flatMap((accessory) => {
      const device = (accessory.context as Context).device;
      return device ? [device] : [];
    });
  }

  private sync(fan: Fan): void {
    const accessory = this.registry.obtain(this.registry.uuid(fan.clientId), fan.deviceName);
    const context = accessory.context as Context;
    const previous = context.device;
    const device: Fan = {
      clientId: fan.clientId,
      host: fan.host,
      mac: fan.mac,
      deviceName: fan.deviceName,
      fanType: fan.fanType,
      firmwareVersion: fan.firmwareVersion,
      lightType: fan.lightType
    };
    context.device = device;
    if (previous && previous.host !== device.host) {
      this.log.info(`${device.deviceName} moved from ${previous.host} to ${device.host}.`);
    }

    this.attach(accessory, device);
    this.registry.publish(accessory, `fan ${device.deviceName} at ${device.host}`);
  }

  private attach(accessory: PlatformAccessory, device: Fan): void {
    const controller = this.controllers.get(accessory.UUID);
    if (controller) {
      controller.update(device);
    } else {
      this.controllers.set(accessory.UUID, new FanAccessory(this, accessory, device, this.timing));
    }
  }
}
