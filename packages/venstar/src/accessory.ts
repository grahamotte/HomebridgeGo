import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import { serialNumber, type Thermostat } from "./discovery.js";
import { describe, Reachability } from "./log.js";
import type { GoVenstarPlatform } from "./platform.js";
import type { Timing } from "./settings.js";
import {
  buildControlFromChange,
  mapVenstarToHomeKit,
  VenstarClient,
  type ThermostatChange,
  type ThermostatValues,
  type VenstarMode
} from "./venstar.js";

// HomeKit reads are answered from the last known state and refreshed in the background,
// so a slow thermostat does not stall the Home app.
export class ThermostatAccessory {
  private readonly thermostat: Service;
  private readonly fan: Service;
  private readonly reachability: Reachability;
  private client: VenstarClient;
  private values?: ThermostatValues;
  private refreshedAt = 0;
  private refreshing?: Promise<ThermostatValues>;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly platform: GoVenstarPlatform,
    private readonly accessory: PlatformAccessory,
    private device: Thermostat,
    private readonly timing: Timing,
  ) {
    const { Service } = platform;
    this.client = new VenstarClient(device.host, timing.requestTimeoutMs);
    this.reachability = new Reachability(platform.log, device.name);
    this.thermostat = accessory.getService(Service.Thermostat) ?? accessory.addService(Service.Thermostat);
    this.fan = accessory.getService(Service.Fanv2) ?? accessory.addService(Service.Fanv2);
    this.setInfo();
    this.bind();
    this.pollTimer = setInterval(() => this.poll(), timing.pollIntervalMs);
    this.pollTimer.unref?.();
    this.poll();
  }

  update(device: Thermostat): void {
    if (device.host !== this.device.host) {
      this.client = new VenstarClient(device.host, this.timing.requestTimeoutMs);
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
      ?.setCharacteristic(Characteristic.Manufacturer, "Venstar")
      .setCharacteristic(Characteristic.Model, "Thermostat")
      .setCharacteristic(Characteristic.SerialNumber, this.device.serialNumber ?? serialNumber(this.device.id))
      .setCharacteristic(Characteristic.Name, this.device.name);
    this.thermostat.setCharacteristic(Characteristic.Name, this.device.name);
    this.fan.setCharacteristic(Characteristic.Name, `${this.device.name} Fan`);
  }

  private bind(): void {
    const { Characteristic } = this.platform;
    this.thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .onGet(async () => (await this.read()).temperatureDisplayUnits);
    this.thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(async () => (await this.read()).currentHeatingCoolingState);
    this.thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .onGet(async () => (await this.read()).targetHeatingCoolingState)
      .onSet((value) => this.set({ mode: Number(value) as VenstarMode }));
    this.thermostat.getCharacteristic(Characteristic.TargetTemperature)
      .onGet(async () => (await this.read()).targetTemperature)
      .onSet((value) => this.set({ targetTemperature: Number(value) }));
    this.thermostat.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .onGet(async () => (await this.read()).coolingThresholdTemperature)
      .onSet((value) => this.set({ coolTemperature: Number(value) }));
    this.thermostat.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .onGet(async () => (await this.read()).heatingThresholdTemperature)
      .onSet((value) => this.set({ heatTemperature: Number(value) }));
    this.thermostat.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(async () => (await this.read()).currentTemperature);
    this.fan.getCharacteristic(Characteristic.Active)
      .onGet(async () => (await this.read()).fanActive)
      .onSet((value: CharacteristicValue) => this.set({ fan: Number(value) }));
  }

  private poll(): void {
    this.refresh().catch(() => undefined);
  }

  private async read(): Promise<ThermostatValues> {
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

  private refresh(): Promise<ThermostatValues> {
    this.refreshing ??= this.client.getInfo()
      .then((info) => this.apply(mapVenstarToHomeKit(info)))
      .catch((error: unknown) => {
        this.reachability.failed(error);
        throw error;
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private async set(change: ThermostatChange): Promise<void> {
    try {
      const current = this.values && Date.now() - this.refreshedAt < this.timing.cacheTtlMs ? this.values : await this.refresh();
      const control = buildControlFromChange(current, change);
      this.platform.log.info(`${this.device.name}: setting mode ${control.mode}, fan ${control.fan}, heat ${control.heattemp}, cool ${control.cooltemp}`);
      await this.client.setControl(control);
      await new Promise((resolve) => setTimeout(resolve, this.timing.settleMs));
      await this.refresh();
    } catch (error) {
      if (!this.reachability.isDown) {
        this.platform.log.warn(`${this.device.name}: update failed: ${describe(error)}`);
      }

      throw this.communicationFailure();
    }
  }

  private apply(values: ThermostatValues): ThermostatValues {
    const { Characteristic } = this.platform;
    this.values = values;
    this.refreshedAt = Date.now();
    this.reachability.succeeded();
    this.thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(values.currentHeatingCoolingState);
    this.thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(values.targetHeatingCoolingState);
    this.thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(values.temperatureDisplayUnits);
    this.thermostat.getCharacteristic(Characteristic.TargetTemperature).updateValue(values.targetTemperature);
    this.thermostat.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(values.coolingThresholdTemperature);
    this.thermostat.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(values.heatingThresholdTemperature);
    this.thermostat.getCharacteristic(Characteristic.CurrentTemperature).updateValue(values.currentTemperature);
    this.fan.getCharacteristic(Characteristic.Active).updateValue(values.fanActive);
    return values;
  }

  private communicationFailure(): Error {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
