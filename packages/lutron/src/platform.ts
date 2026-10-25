import path from "node:path";
import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from "homebridge";
import { identify, LutronBridge, type Pico, type Shade } from "./bridge.js";
import { parseConfig, type Settings } from "./config.js";
import { discoverBridges, type DiscoveredBridge } from "./discovery.js";
import type { SocketFactory } from "./leap.js";
import { describe } from "./log.js";
import { pair } from "./pairing.js";
import { PicoAccessory } from "./pico.js";
import { AccessoryRegistry } from "./registry.js";
import { DEFAULT_TIMING, PLATFORM_NAME, PLUGIN_NAME, STORAGE_DIRECTORY, type Timing } from "./settings.js";
import { ShadeAccessory } from "./shade.js";
import { CredentialStore, type BridgeRecord } from "./store.js";

interface Context {
  bridge?: string;
  shade?: Shade;
  pico?: Pico;
}

export interface PlatformDependencies {
  readonly connect?: SocketFactory;
  readonly discover?: (timeoutMs: number) => Promise<DiscoveredBridge[]>;
  readonly storagePath?: string;
  readonly timing?: Partial<Timing>;
}

export class GoLutronPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly settings: Settings;
  public readonly store: CredentialStore;
  private readonly registry: AccessoryRegistry;
  private readonly controllers = new Map<string, ShadeAccessory>();
  private readonly picos = new Map<string, PicoAccessory>();
  private readonly bridges = new Map<string, LutronBridge>();
  private readonly timing: Timing;
  private refreshing?: Promise<void>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private readonly pairing = new AbortController();
  private reportedDiscoveryFailure = false;
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
    this.store = new CredentialStore(path.join(dependencies.storagePath ?? api.user.storagePath(), STORAGE_DIRECTORY));
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
    this.refresh().catch(() => undefined);
    this.refreshTimer = setInterval(() => {
      this.refresh().catch(() => undefined);
    }, this.timing.discoveryIntervalMs);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    this.pairing.abort();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const bridge of this.bridges.values()) {
      bridge.stop();
    }

    this.bridges.clear();
    for (const pico of this.picos.values()) {
      pico.reset();
    }
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.findBridges()
      .catch((error: unknown) => {
        this.log.error(`Bridge discovery failed: ${describe(error)}`);
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private async findBridges(): Promise<void> {
    const discover = this.dependencies.discover ?? discoverBridges;
    const hosts = this.settings.hosts;
    const discovered = hosts.length > 0 ? [] : await discover(this.timing.discoveryTimeoutMs).then((bridges) => {
      this.reportedDiscoveryFailure = false;
      return bridges;
    }, (error: unknown) => {
      this.log[this.reportedDiscoveryFailure ? "debug" : "warn"](`mDNS discovery failed: ${describe(error)}`);
      this.reportedDiscoveryFailure = true;
      return [];
    });
    if (this.stopped) {
      return;
    }

    const records = this.store.list();
    const pairings: Promise<void>[] = [];
    for (const bridge of discovered) {
      const record = records.find((candidate) => candidate.id === bridge.id);
      if (record) {
        this.ensureBridge(record.host === bridge.host ? record : this.saveHost(record, bridge.host));
      } else {
        pairings.push(this.pairBridge(bridge.host));
      }
    }

    for (const host of hosts) {
      // With one bridge and one configured host, a changed address still points at the paired bridge.
      const record = records.find((candidate) => candidate.host === host) ?? (records.length === 1 && hosts.length === 1 ? records[0] : undefined);
      if (record) {
        this.ensureBridge(record.host === host ? record : this.saveHost(record, host));
      } else {
        pairings.push(this.pairBridge(host));
      }
    }

    if (hosts.length === 0) {
      for (const record of records) {
        this.ensureBridge(record);
      }
    }

    const missing = discovered.length === 0 && records.length === 0 && hosts.length === 0;
    if (missing && !this.reportedMissing) {
      this.log.warn("No Lutron bridge found. Set hosts if mDNS is blocked on this network.");
    }

    this.reportedMissing = missing;

    await Promise.all(pairings);
  }

  private async pairBridge(host: string): Promise<void> {
    this.log.warn(`Found an unpaired Lutron bridge at ${host}. Press the small black button on the back of the bridge to pair.`);
    try {
      const credentials = await pair(host, {
        timeoutMs: this.timing.pairingTimeoutMs,
        requestTimeoutMs: this.timing.requestTimeoutMs,
        connect: this.dependencies.connect,
        signal: this.pairing.signal
      });
      const id = await identify(host, credentials, this.dependencies.connect, this.timing.requestTimeoutMs);
      const record = { id, host, ...credentials };
      this.store.save(record);
      this.log.info(`Paired with bridge ${id} at ${host}.`);
      if (!this.stopped) {
        this.ensureBridge(record);
      }
    } catch (error) {
      if (!this.stopped) {
        this.log.warn(`Pairing with the bridge at ${host} failed: ${describe(error)}. Will retry.`);
      }
    }
  }

  private saveHost(record: BridgeRecord, host: string): BridgeRecord {
    const updated = { ...record, host };
    try {
      this.store.save(updated);
    } catch (error) {
      this.log.warn(`Could not save the new address of bridge ${record.id}: ${describe(error)}`);
    }

    return updated;
  }

  private ensureBridge(record: BridgeRecord): void {
    if (this.stopped) {
      return;
    }

    const existing = this.bridges.get(record.id);
    if (existing) {
      existing.setHost(record.host);
      return;
    }

    const bridge: LutronBridge = new LutronBridge(record, this.log, {
      devices: (shades, picos) => this.syncDevices(bridge, shades, picos),
      level: (zone, level) => this.applyLevel(bridge.id, zone, level),
      button: (button, event) => this.applyButton(bridge.id, button, event),
      online: (online) => {
        if (!online) {
          this.resetPicos(bridge.id);
        }
      }
    }, this.dependencies.connect, this.timing);
    this.bridges.set(record.id, bridge);
    for (const accessory of this.registry.all()) {
      const uuid = accessory.UUID;
      const context = accessory.context as Context;
      if (context.bridge === bridge.id && context.shade && !this.controllers.has(uuid)) {
        this.controllers.set(uuid, new ShadeAccessory(this, accessory, context.shade, bridge));
      }

      if (context.bridge === bridge.id && context.pico && !this.picos.has(uuid)) {
        this.picos.set(uuid, new PicoAccessory(this, accessory, context.pico, this.timing));
      }
    }

    bridge.start();
  }

  // A Pico list of undefined means the bridge could not report its buttons, so cached Picos are kept as they are.
  private syncDevices(bridge: LutronBridge, shades: readonly Shade[], picos?: readonly Pico[]): void {
    const seen = new Set<string>();
    for (const shade of shades) {
      const accessory = this.accessoryFor(bridge, shade.serial, shade.name);
      const uuid = accessory.UUID;
      seen.add(uuid);
      const context = accessory.context as Context;
      context.bridge = bridge.id;
      context.shade = { ...shade };
      const controller = this.controllers.get(uuid);
      if (controller) {
        controller.update(shade, bridge);
      } else {
        this.controllers.set(uuid, new ShadeAccessory(this, accessory, shade, bridge));
      }

      this.registry.publish(accessory, `shade ${shade.name}`);
    }

    for (const pico of picos ?? []) {
      const accessory = this.accessoryFor(bridge, pico.serial, pico.name);
      const uuid = accessory.UUID;
      seen.add(uuid);
      const context = accessory.context as Context;
      context.bridge = bridge.id;
      context.pico = { ...pico, buttons: pico.buttons.map((button) => ({ ...button })) };
      const controller = this.picos.get(uuid);
      if (controller) {
        controller.update(pico);
      } else {
        this.picos.set(uuid, new PicoAccessory(this, accessory, pico, this.timing));
      }

      this.registry.publish(accessory, `Pico ${pico.name}`);
    }

    for (const accessory of this.registry.all()) {
      const uuid = accessory.UUID;
      const context = accessory.context as Context;
      if (seen.has(uuid) || context.bridge !== bridge.id || (picos === undefined && context.pico)) {
        continue;
      }

      this.registry.remove(accessory, `${context.pico ? "Pico" : "shade"} ${accessory.displayName}`, "the bridge no longer reports it");
      this.controllers.delete(uuid);
      this.picos.get(uuid)?.reset();
      this.picos.delete(uuid);
    }
  }

  private accessoryFor(bridge: LutronBridge, serial: string, name: string): PlatformAccessory {
    return this.registry.obtain(this.registry.uuid(`${PLUGIN_NAME}:${bridge.id}:${serial}`), name);
  }

  private applyLevel(bridge: string, zone: string, level: number): void {
    for (const [uuid, controller] of this.controllers) {
      if (controller.zone === zone && (this.registry.get(uuid)?.context as Context | undefined)?.bridge === bridge) {
        controller.setLevel(level);
      }
    }
  }

  private applyButton(bridge: string, button: string, event: string): void {
    for (const [uuid, controller] of this.picos) {
      if (controller.has(button) && (this.registry.get(uuid)?.context as Context | undefined)?.bridge === bridge) {
        controller.handle(button, event);
      }
    }
  }

  private resetPicos(bridge: string): void {
    for (const [uuid, controller] of this.picos) {
      if ((this.registry.get(uuid)?.context as Context | undefined)?.bridge === bridge) {
        controller.reset();
      }
    }
  }
}
