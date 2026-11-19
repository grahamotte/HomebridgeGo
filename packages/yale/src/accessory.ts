import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import { RequestCancelled, YaleLock, type LockSettings } from "./lock.js";
import { describe, Reachability } from "./log.js";
import type { GoYalePlatform } from "./platform.js";
import type { DoorStatus, LockStatus, StatusUpdate } from "./protocol.js";
import { LOW_BATTERY_PERCENT, type Timing } from "./settings.js";

export class LockAccessory {
  private readonly lock: YaleLock;
  private readonly mechanism: Service;
  private readonly battery: Service;
  private readonly contact?: Service;
  private readonly reachability: Reachability;
  private current: number;
  private target: number;
  private door?: number;
  private pollTimer?: ReturnType<typeof setInterval>;
  private request = 0;
  private commandPending = false;

  constructor(
    private readonly platform: GoYalePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly settings: LockSettings,
    timing: Timing,
  ) {
    const { Characteristic, Service } = platform;
    this.current = Characteristic.LockCurrentState.UNKNOWN;
    this.target = Characteristic.LockTargetState.SECURED;
    this.reachability = new Reachability(platform.log, settings.name);
    this.lock = new YaleLock(platform.bluez, settings, platform.log, (update) => this.apply(update), timing);
    this.mechanism = accessory.getService(Service.LockMechanism) ?? accessory.addService(Service.LockMechanism);
    this.battery = accessory.getService(Service.Battery) ?? accessory.addService(Service.Battery);
    this.contact = this.doorService();

    this.setInfo();
    this.bind();
    this.startPolling();
    this.refresh();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    await this.lock.stop();
  }

  private setInfo(): void {
    const { Characteristic, Service } = this.platform;
    this.accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, "Yale")
      .setCharacteristic(Characteristic.Model, "Bluetooth Lock")
      .setCharacteristic(Characteristic.SerialNumber, this.settings.address)
      .setCharacteristic(Characteristic.Name, this.settings.name);
    this.mechanism.setCharacteristic(Characteristic.Name, this.settings.name);
    this.battery.setCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE);
    this.contact?.setCharacteristic(Characteristic.Name, `${this.settings.name} Door`);
  }

  // The door sensor is opt-in, because a lock without one never answers the door query.
  private doorService(): Service | undefined {
    const { Service } = this.platform;
    const existing = this.accessory.getService(Service.ContactSensor);
    if (!this.settings.doorSensor) {
      if (existing) {
        this.accessory.removeService(existing);
      }

      return undefined;
    }

    return existing ?? this.accessory.addService(Service.ContactSensor, `${this.settings.name} Door`);
  }

  private bind(): void {
    const { Characteristic } = this.platform;
    this.mechanism.getCharacteristic(Characteristic.LockCurrentState).onGet(() => this.current);
    this.mechanism.getCharacteristic(Characteristic.LockTargetState)
      .onGet(() => this.target)
      .onSet((value) => this.setTarget(value));
    this.contact?.getCharacteristic(Characteristic.ContactSensorState).onGet(() => {
      if (this.door === undefined) {
        const { hap } = this.platform.api;
        throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }

      return this.door;
    });
  }

  private startPolling(): void {
    if (this.platform.settings.pollIntervalMs === 0) {
      return;
    }

    this.pollTimer = setInterval(() => this.refresh(), this.platform.settings.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  private refresh(): void {
    this.lock.refresh(() => !this.commandPending)
      .then((snapshot) => {
        this.reachability.succeeded();
        this.apply({ kind: "lock", status: snapshot.lock });
        if (snapshot.battery !== undefined) {
          this.apply({ kind: "battery", voltage: 0, percentage: snapshot.battery });
        }

        if (snapshot.door !== undefined) {
          this.apply({ kind: "door", status: snapshot.door });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof RequestCancelled) {
          this.platform.log.debug(`${this.settings.name}: refresh skipped for a lock request`);
          return;
        }

        this.reachability.failed(error);
      });
  }

  private setTarget(value: CharacteristicValue): void {
    const { Characteristic } = this.platform;
    const locked = Number(value) === Characteristic.LockTargetState.SECURED;
    this.target = locked ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
    const request = ++this.request;
    const deadline = Date.now() + this.platform.settings.commandTimeoutMs;
    this.commandPending = true;
    this.platform.log.info(`${this.settings.name}: ${locked ? "locking" : "unlocking"}`);
    this.lock.setLocked(locked, () => request === this.request && Date.now() < deadline)
      .then(() => {
        this.reachability.succeeded();
        this.platform.log.info(`${this.settings.name}: ${locked ? "locked" : "unlocked"}`);
      })
      .catch((error: unknown) => {
        if (request !== this.request) {
          this.platform.log.debug(`${this.settings.name}: ${locked ? "lock" : "unlock"} request superseded`);
          return;
        }

        if (error instanceof RequestCancelled) {
          this.platform.log.warn(`${this.settings.name}: ${locked ? "lock" : "unlock"} request expired before reaching the lock`);
          this.restoreTarget();
          return;
        }

        this.platform.log.warn(`${this.settings.name}: ${locked ? "lock" : "unlock"} failed: ${describe(error)}`);
        this.commandPending = false;
        this.refresh();
      })
      .finally(() => {
        if (request === this.request) {
          this.commandPending = false;
        }
      });
  }

  private restoreTarget(): void {
    const { Characteristic } = this.platform;
    if (this.current !== Characteristic.LockCurrentState.SECURED && this.current !== Characteristic.LockCurrentState.UNSECURED) {
      return;
    }

    this.target = this.current === Characteristic.LockCurrentState.SECURED
      ? Characteristic.LockTargetState.SECURED
      : Characteristic.LockTargetState.UNSECURED;
    this.mechanism.getCharacteristic(Characteristic.LockTargetState).updateValue(this.target);
  }

  private apply(update: StatusUpdate): void {
    const { Characteristic } = this.platform;
    if (update.kind === "battery") {
      this.battery.getCharacteristic(Characteristic.BatteryLevel).updateValue(update.percentage);
      this.battery.getCharacteristic(Characteristic.StatusLowBattery).updateValue(update.percentage < LOW_BATTERY_PERCENT
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      return;
    }

    if (update.kind === "door") {
      this.applyDoor(update.status);
      return;
    }

    if (update.kind !== "lock") {
      return;
    }

    const current = this.currentState(update.status);
    if (current === undefined) {
      return;
    }

    this.current = current;
    this.mechanism.getCharacteristic(Characteristic.LockCurrentState).updateValue(current);
    if (current === Characteristic.LockCurrentState.SECURED || current === Characteristic.LockCurrentState.UNSECURED) {
      this.target = current === Characteristic.LockCurrentState.SECURED
        ? Characteristic.LockTargetState.SECURED
        : Characteristic.LockTargetState.UNSECURED;
      this.mechanism.getCharacteristic(Characteristic.LockTargetState).updateValue(this.target);
    }
  }

  private applyDoor(status: DoorStatus): void {
    if (!this.contact || status === "unknown") {
      return;
    }

    const { Characteristic } = this.platform;
    this.door = status === "closed"
      ? Characteristic.ContactSensorState.CONTACT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    this.contact.getCharacteristic(Characteristic.ContactSensorState).updateValue(this.door);
  }

  private currentState(status: LockStatus): number | undefined {
    const { LockCurrentState } = this.platform.Characteristic;
    switch (status) {
      case "locked":
      case "securemode":
        return LockCurrentState.SECURED;
      case "unlocked":
      case "unlatched":
        return LockCurrentState.UNSECURED;
      case "jammed":
        return LockCurrentState.JAMMED;
      case "locking":
      case "unlocking":
      case "unlatching":
        return undefined;
      default:
        return LockCurrentState.UNKNOWN;
    }
  }
}
