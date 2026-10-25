import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from "homebridge";
import { LockAccessory } from "./accessory.js";
import { Bluez, type BusFactory } from "./bluez.js";
import { parseConfig, type Settings } from "./config.js";
import type { LockSettings } from "./lock.js";
import { AccessoryRegistry } from "./registry.js";
import { DEFAULT_TIMING, PLATFORM_NAME, PLUGIN_NAME, type Timing } from "./settings.js";

interface Context {
  address?: string;
}

export interface PlatformDependencies {
  readonly createBus?: BusFactory;
  readonly timing?: Partial<Timing>;
}

// Locks cannot be discovered: each needs its offline key, so the configured list is the source of truth.
export class GoYalePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly settings: Settings;
  public readonly bluez: Bluez;
  private readonly registry: AccessoryRegistry;
  private readonly controllers = new Map<string, LockAccessory>();
  private readonly timing: Timing;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
    dependencies: PlatformDependencies = {},
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.registry = new AccessoryRegistry(api, log, PLUGIN_NAME, PLATFORM_NAME);
    const { settings, problems } = parseConfig(config);
    this.settings = settings;
    this.timing = { ...DEFAULT_TIMING, idleDisconnectMs: settings.idleDisconnectMs, ...dependencies.timing };
    this.bluez = new Bluez(dependencies.createBus, settings.adapter);
    for (const problem of problems) {
      this.log.error(problem);
    }

    api.on("didFinishLaunching", () => this.start());
    api.on("shutdown", () => {
      this.stop().catch(() => undefined);
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.registry.configure(accessory);
  }

  start(): void {
    const configured = new Set<string>();
    for (const lock of this.settings.locks) {
      const accessory = this.registry.obtain(this.registry.uuid(`${PLUGIN_NAME}:${lock.address}`), lock.name);
      configured.add(accessory.UUID);
      (accessory.context as Context).address = lock.address;
      this.attach(accessory, lock);
      this.registry.publish(accessory, `lock ${lock.name} (${lock.address})`);
    }

    for (const accessory of this.registry.all()) {
      if (!configured.has(accessory.UUID)) {
        this.registry.remove(accessory, `lock ${accessory.displayName}`, "it is no longer configured");
      }
    }
  }

  async stop(): Promise<void> {
    const controllers = [...this.controllers.values()];
    this.controllers.clear();
    await Promise.all(controllers.map((controller) => controller.stop()));
    this.bluez.close();
  }

  private attach(accessory: PlatformAccessory, lock: LockSettings): void {
    this.controllers.get(accessory.UUID)?.stop().catch(() => undefined);
    this.controllers.set(accessory.UUID, new LockAccessory(this, accessory, lock, this.timing));
  }
}
