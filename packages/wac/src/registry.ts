// Shared by every plugin in this repository. Keep the copies identical; `npm run check:shared` enforces it.
import type { API, PlatformAccessory } from "homebridge";
import type { Log } from "./log.js";

// Tracks the platform's HomeKit accessories and logs every add, restore, and removal the same way.
export class AccessoryRegistry {
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly announced = new Set<string>();

  constructor(
    private readonly api: API,
    private readonly log: Log,
    private readonly pluginName: string,
    private readonly platformName: string,
  ) {}

  // Called from configureAccessory for each accessory Homebridge restores from its cache.
  configure(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  uuid(id: string): string {
    return this.api.hap.uuid.generate(id);
  }

  has(uuid: string): boolean {
    return this.accessories.has(uuid);
  }

  get(uuid: string): PlatformAccessory | undefined {
    return this.accessories.get(uuid);
  }

  all(): PlatformAccessory[] {
    return [...this.accessories.values()];
  }

  // Returns the cached accessory, or a new one that publish() will register.
  obtain(uuid: string, name: string): PlatformAccessory {
    return this.accessories.get(uuid) ?? new this.api.platformAccessory(name, uuid);
  }

  // Registers a new accessory, or saves a cached one's context. Call it after the accessory's services are set up.
  publish(accessory: PlatformAccessory, label: string): void {
    if (this.accessories.has(accessory.UUID)) {
      this.api.updatePlatformAccessories([accessory]);
      if (!this.announced.has(accessory.UUID)) {
        this.log.info(`Restored ${label}.`);
      }
    } else {
      this.log.info(`Adding ${label}.`);
      this.accessories.set(accessory.UUID, accessory);
      this.api.registerPlatformAccessories(this.pluginName, this.platformName, [accessory]);
    }

    this.announced.add(accessory.UUID);
  }

  remove(accessory: PlatformAccessory, label: string, reason: string): void {
    this.log.warn(`Removing ${label}; ${reason}.`);
    this.api.unregisterPlatformAccessories(this.pluginName, this.platformName, [accessory]);
    this.accessories.delete(accessory.UUID);
    this.announced.delete(accessory.UUID);
  }
}
