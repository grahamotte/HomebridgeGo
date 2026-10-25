import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";
import {
  DISCOVERY_TIMEOUT_MS,
  PLATFORM_NAME,
  PLUGIN_NAME,
  REQUEST_TIMEOUT_MS,
} from "./settings.js";
import { homeKitSerialNumber } from "./serial.js";
import { discoverSsdpDevices } from "./ssdp.js";
import { Thermostat } from "./thermostat.js";
import { VenstarClient } from "./venstar.js";

interface DiscoveredDevice {
  readonly id: string;
  readonly host: string;
  readonly name: string;
  readonly serialNumber: string;
  readonly usn?: string;
}

interface VenstarAccessoryContext {
  device?: DiscoveredDevice & {
    readonly lastSeen: string;
  };
}

export class GoVenstarPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`Discovery failed: ${message}`);
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info("Loading accessory from cache:", accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(): Promise<void> {
    this.log.info("Discovering Venstar thermostats...");

    const devices = new Map<string, DiscoveredDevice>();
    for (const device of dedupeByHost(await this.discoverWithSsdp())) {
      devices.set(device.id, device);
    }

    this.syncAccessories([...devices.values()]);
    this.log.info(`Venstar discovery finished: ${devices.size} thermostat(s) available.`);
  }

  private async discoverWithSsdp(): Promise<DiscoveredDevice[]> {
    const devices = new Map<string, DiscoveredDevice>();
    const responses = await discoverSsdpDevices(
      "venstar:thermostat:ecp",
      DISCOVERY_TIMEOUT_MS,
    );
    const probes = responses.map((response) => {
      const host = hostFromSsdpLocation(response.location);
      if (!host) {
        return Promise.resolve();
      }

      const id = response.usn ? `ssdp:${response.usn}` : `host:${host}`;
      return this.probeHost(host, id, response.usn)
        .then((device) => {
          devices.set(device.id, device);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.log.debug(message);
        });
    });

    await Promise.allSettled(probes);
    return [...devices.values()];
  }

  private async probeHost(
    host: string,
    fallbackId: string,
    usn?: string,
  ): Promise<DiscoveredDevice> {
    const normalizedHost = normalizeHost(host);
    const info = await new VenstarClient(
      normalizedHost,
      REQUEST_TIMEOUT_MS,
    ).getInfo();

    return {
      id: fallbackId,
      host: normalizedHost,
      name: info.name,
      serialNumber: homeKitSerialNumber(fallbackId, usn),
      usn,
    };
  }

  private syncAccessories(devices: readonly DiscoveredDevice[]): void {
    const seenUuids = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.id);
      const accessory =
        this.accessories.get(uuid) ??
        this.findReusableCachedAccessory(device) ??
        new this.api.platformAccessory(device.name, uuid);
      const wasCached = this.accessories.has(accessory.UUID);

      seenUuids.add(accessory.UUID);
      updateAccessoryContext(accessory, device);
      new Thermostat(this, accessory, device);

      if (wasCached) {
        this.log.info(`Restored thermostat ${device.name} at ${device.host}.`);
      } else {
        this.log.info(`Adding thermostat ${device.name} at ${device.host}.`);
        this.accessories.set(accessory.UUID, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (seenUuids.has(uuid)) {
        continue;
      }

      const context = accessory.context as VenstarAccessoryContext;
      if (context.device) {
        this.log.warn(
          `Keeping cached thermostat ${context.device.name}; it was not discovered this run.`,
        );
        new Thermostat(this, accessory, context.device);
      }
    }
  }

  private findReusableCachedAccessory(
    device: DiscoveredDevice,
  ): PlatformAccessory | undefined {
    const legacyHost = hostnameOnly(device.host);
    const legacyUuids = [
      this.api.hap.uuid.generate(legacyHost),
      this.api.hap.uuid.generate(`host:${device.host}`),
    ];

    for (const uuid of legacyUuids) {
      const accessory = this.accessories.get(uuid);
      if (accessory) {
        return accessory;
      }
    }

    return [...this.accessories.values()].find((accessory) => {
      const context = accessory.context as VenstarAccessoryContext;
      return context.device?.host === device.host || context.device?.id === device.id;
    });
  }
}

function updateAccessoryContext(
  accessory: PlatformAccessory,
  device: DiscoveredDevice,
): void {
  const context = accessory.context as VenstarAccessoryContext;
  context.device = {
    ...device,
    lastSeen: new Date().toISOString(),
  };
}

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return parsed.host;
  } catch {
    return trimmed.replace(/^https?:\/\//u, "").split("/")[0] ?? "";
  }
}

function hostFromSsdpLocation(location: string | undefined): string {
  if (!location) {
    return "";
  }

  try {
    return normalizeHost(new URL(location).host);
  } catch {
    return "";
  }
}

function dedupeByHost(devices: readonly DiscoveredDevice[]): DiscoveredDevice[] {
  const byHost = new Map<string, DiscoveredDevice>();

  for (const device of devices) {
    const existing = byHost.get(device.host);
    if (!existing || shouldPreferDevice(device, existing)) {
      byHost.set(device.host, device);
    }
  }

  return [...byHost.values()];
}

function shouldPreferDevice(
  candidate: DiscoveredDevice,
  existing: DiscoveredDevice,
): boolean {
  return candidate.id.startsWith("ssdp:") && !existing.id.startsWith("ssdp:");
}

function hostnameOnly(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
}

