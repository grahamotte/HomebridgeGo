import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { Fan } from "./discovery.js";
import { describe, Reachability } from "./log.js";
import type { GoWacFansPlatform } from "./platform.js";
import type { Timing } from "./settings.js";
import { mapState, speedFromHomeKit, WacClient, type FanChange, type FanState, type FanValues } from "./wac.js";

// HomeKit reads are answered from the last known state and refreshed in the background,
// so a slow fan does not stall the Home app.
export class FanAccessory {
  private readonly fan: Service;
  private readonly light?: Service;
  private readonly reachability: Reachability;
  private client: WacClient;
  private values?: FanValues;
  private refreshedAt = 0;
  private refreshing?: Promise<FanValues>;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly platform: GoWacFansPlatform,
    private readonly accessory: PlatformAccessory,
    private device: Fan,
    private readonly timing: Timing,
  ) {
    const { Service } = platform;
    this.client = new WacClient(device.host, timing.requestTimeoutMs);
    this.reachability = new Reachability(platform.log, device.deviceName);
    this.fan = accessory.getService(Service.Fanv2) ?? accessory.addService(Service.Fanv2);
    this.light = device.lightType ? accessory.getService(Service.Lightbulb) ?? accessory.addService(Service.Lightbulb) : undefined;
    this.setInfo();
    this.bind();
    this.pollTimer = setInterval(() => this.poll(), timing.pollIntervalMs);
    this.pollTimer.unref?.();
    this.poll();
  }

  update(device: Fan): void {
    if (device.host !== this.device.host) {
      this.client = new WacClient(device.host, this.timing.requestTimeoutMs);
    }

    this.device = device;
    this.setInfo();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private setInfo(): void {
    const { Characteristic, Service } = this.platform;
    this.accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, "WAC")
      .setCharacteristic(Characteristic.Model, this.device.fanType)
      .setCharacteristic(Characteristic.SerialNumber, this.device.mac)
      .setCharacteristic(Characteristic.FirmwareRevision, this.device.firmwareVersion)
      .setCharacteristic(Characteristic.Name, this.device.deviceName);
    this.fan.setCharacteristic(Characteristic.Name, this.device.deviceName);
    this.light?.setCharacteristic(Characteristic.Name, `${this.device.deviceName} Light`);
  }

  private bind(): void {
    const { Characteristic } = this.platform;
    this.fan.getCharacteristic(Characteristic.Active)
      .onGet(async () => (await this.read()).active)
      .onSet((value) => this.setActive(value));
    this.fan.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minStep: 100 / 6 })
      .onGet(async () => (await this.read()).speed)
      .onSet((value) => this.setSpeed(value));
    this.fan.getCharacteristic(Characteristic.RotationDirection)
      .onGet(async () => (await this.read()).direction)
      .onSet((value) => this.set({ fanDirection: Number(value) === 1 ? "reverse" : "forward" }));
    this.light?.getCharacteristic(Characteristic.On)
      .onGet(async () => (await this.read()).lightOn)
      .onSet((value) => this.set({ lightOn: Boolean(value) }));
    this.light?.getCharacteristic(Characteristic.Brightness)
      .onGet(async () => (await this.read()).brightness)
      .onSet((value) => this.set({ lightOn: Number(value) > 0, lightBrightness: Number(value) }));
  }

  private poll(): void {
    this.refresh().catch(() => undefined);
  }

  private async read(): Promise<FanValues> {
    if (this.values) {
      if (Date.now() - this.refreshedAt >= this.timing.cacheTtlMs) {
        this.poll();
      }

      return this.values;
    }

    try {
      return await this.refresh();
    } catch {
      throw this.communicationFailure();
    }
  }

  private refresh(): Promise<FanValues> {
    this.refreshing ??= this.client.getState()
      .then((state) => this.apply(state))
      .catch((error: unknown) => {
        this.reachability.failed(error);
        throw error;
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const active = Number(value) === 1;
    const speed = active ? speedFromHomeKit((await this.read()).speed || 100 / 6) : undefined;
    await this.set({ fanOn: active, fanSpeed: speed });
  }

  private async setSpeed(value: CharacteristicValue): Promise<void> {
    const speed = Number(value);
    await this.set(speed <= 0 ? { fanOn: false } : { fanOn: true, fanSpeed: speedFromHomeKit(speed) });
  }

  private async set(change: FanChange): Promise<void> {
    this.platform.log.info(`${this.device.deviceName}: setting ${describeChange(change)}`);
    try {
      this.apply(await this.client.set(change));
    } catch (error) {
      if (!this.reachability.isDown) {
        this.platform.log.warn(`${this.device.deviceName}: update failed: ${describe(error)}`);
      }

      throw this.communicationFailure();
    }
  }

  private apply(state: FanState): FanValues {
    const { Characteristic } = this.platform;
    const values = mapState(state);
    this.values = values;
    this.refreshedAt = Date.now();
    this.reachability.succeeded();
    this.fan.getCharacteristic(Characteristic.Active).updateValue(values.active);
    this.fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(values.speed);
    this.fan.getCharacteristic(Characteristic.RotationDirection).updateValue(values.direction);
    this.light?.getCharacteristic(Characteristic.On).updateValue(values.lightOn);
    this.light?.getCharacteristic(Characteristic.Brightness).updateValue(values.brightness);
    return values;
  }

  private communicationFailure(): Error {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}

function describeChange(change: FanChange): string {
  return Object.entries(change)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(", ");
}
