import { GoVenstarPlatform } from "../dist/platform.js";

export const HOST = "192.168.1.218";
export const USN = "colortouch:ecp:00:9D:6B:A0:67:6B:name:HALLWAY:type:residential";
export const FAST_TIMING = {
  discoveryIntervalMs: 60000,
  discoveryTimeoutMs: 10,
  requestTimeoutMs: 200,
  pollIntervalMs: 60000,
  cacheTtlMs: 5000,
  settleMs: 0
};

// Answers the Venstar local API for the thermostats in `devices`, keyed by host.
export class FakeThermostats {
  constructor(devices = { [HOST]: info() }) {
    this.devices = devices;
    this.controls = [];
    this.fetch = async (url, init = {}) => {
      const target = new URL(String(url));
      const device = this.devices[target.host];
      if (!device) {
        throw new Error("connect ECONNREFUSED");
      }

      if (target.pathname === "/control" && init.method === "POST") {
        const control = Object.fromEntries([...target.searchParams].map(([key, value]) => [key, Number(value)]));
        this.controls.push({ host: target.host, ...control });
        Object.assign(device, control);
        return json({ success: true });
      }

      return json(device);
    };
  }
}

export function info(overrides = {}) {
  return { name: "Hallway", mode: 1, state: 0, fan: 0, fanstate: 0, tempunits: 0, spacetemp: 70, heattemp: 68, cooltemp: 76, ...overrides };
}

function json(data) {
  return { ok: true, status: 200, statusText: "OK", json: async () => data };
}

export function createPlatform({ config = {}, thermostats = new FakeThermostats(), ssdp = [{ location: `http://${HOST}/`, usn: USN }], timing = {} } = {}) {
  globalThis.fetch = thermostats.fetch;
  const { messages, logger } = createLog();
  const api = createApi();
  const searches = [];
  const platform = new GoVenstarPlatform(logger, { platform: "GoVenstar", ...config }, api, {
    search: async (target, timeoutMs) => {
      searches.push({ target, timeoutMs });
      if (ssdp instanceof Error) {
        throw ssdp;
      }

      return typeof ssdp === "function" ? ssdp() : ssdp;
    },
    timing: { ...FAST_TIMING, ...timing }
  });
  return { api, messages, platform, searches, thermostats };
}

export function createLog() {
  const messages = { debug: [], error: [], info: [], warn: [] };
  const logger = {
    debug: (...parts) => messages.debug.push(parts.join(" ")),
    error: (...parts) => messages.error.push(parts.join(" ")),
    info: (...parts) => messages.info.push(parts.join(" ")),
    warn: (...parts) => messages.warn.push(parts.join(" "))
  };
  return { messages, logger };
}

export async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error("condition was never met");
}

export async function settle() {
  for (let index = 0; index < 20; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createApi() {
  const handlers = {};
  const api = {
    hap: {
      Characteristic: {
        Active: { name: "Active" },
        CoolingThresholdTemperature: { name: "CoolingThresholdTemperature" },
        CurrentHeatingCoolingState: { name: "CurrentHeatingCoolingState" },
        CurrentTemperature: { name: "CurrentTemperature" },
        HeatingThresholdTemperature: { name: "HeatingThresholdTemperature" },
        Manufacturer: { name: "Manufacturer" },
        Model: { name: "Model" },
        Name: { name: "Name" },
        SerialNumber: { name: "SerialNumber" },
        TargetHeatingCoolingState: { name: "TargetHeatingCoolingState" },
        TargetTemperature: { name: "TargetTemperature" },
        TemperatureDisplayUnits: { name: "TemperatureDisplayUnits" }
      },
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      HapStatusError: class HapStatusError extends Error {
        constructor(status) {
          super(`HAP status ${status}`);
          this.hapStatus = status;
        }
      },
      Service: {
        AccessoryInformation: "AccessoryInformation",
        Fanv2: "Fanv2",
        Thermostat: "Thermostat"
      },
      uuid: {
        generate: (value) => `uuid:${value}`
      }
    },
    on: (event, handler) => {
      handlers[event] = handler;
    },
    emit: (event) => handlers[event]?.(),
    platformAccessory: FakePlatformAccessory,
    registered: [],
    unregistered: [],
    updated: [],
    registerPlatformAccessories: (_plugin, _platform, accessories) => api.registered.push(...accessories),
    unregisterPlatformAccessories: (_plugin, _platform, accessories) => api.unregistered.push(...accessories),
    updatePlatformAccessories: (accessories) => api.updated.push(...accessories)
  };
  return api;
}

export class FakePlatformAccessory {
  constructor(displayName, uuid) {
    this.context = {};
    this.displayName = displayName;
    this.UUID = uuid;
    this.services = new Map();
    this.addService("AccessoryInformation");
  }

  addService(name) {
    const service = new FakeService();
    this.services.set(name, service);
    return service;
  }

  getService(name) {
    return this.services.get(name);
  }
}

class FakeService {
  constructor() {
    this.characteristics = new Map();
  }

  getCharacteristic(type) {
    if (!this.characteristics.has(type.name)) {
      this.characteristics.set(type.name, new FakeCharacteristic());
    }

    return this.characteristics.get(type.name);
  }

  setCharacteristic(type, value) {
    this.getCharacteristic(type).value = value;
    return this;
  }
}

class FakeCharacteristic {
  setProps(props) {
    this.props = props;
    return this;
  }

  onGet(handler) {
    this.getHandler = handler;
    return this;
  }

  onSet(handler) {
    this.setHandler = handler;
    return this;
  }

  updateValue(value) {
    this.value = value;
    return this;
  }
}
