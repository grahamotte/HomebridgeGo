import { GoWacFansPlatform } from "../dist/platform.js";

export const HOST = "192.168.1.220";
export const FAST_TIMING = {
  discoveryIntervalMs: 60000,
  discoveryTimeoutMs: 200,
  sweepIntervalMs: 60000,
  requestTimeoutMs: 200,
  pollIntervalMs: 60000,
  cacheTtlMs: 5000
};

export function info(overrides = {}) {
  return {
    clientId: "MF_1",
    mac: "00:11:22:33:44:55",
    deviceName: "Center",
    fanType: "Ceiling Fan",
    firmwareVersion: "1.0.0",
    lightType: "dimmer",
    ...overrides
  };
}

export function state(overrides = {}) {
  return { clientId: "MF_1", fanOn: false, fanSpeed: 1, fanDirection: "forward", lightOn: false, lightBrightness: 100, ...overrides };
}

// Answers the fans' local `POST /mf` API for the fans in `devices`, keyed by host.
export class FakeFans {
  constructor(devices = { [HOST]: { info: info(), state: state() } }) {
    this.devices = devices;
    this.changes = [];
    this.probed = [];
    this.fetch = async (url, init = {}) => {
      const host = new URL(String(url)).host;
      const payload = JSON.parse(String(init.body ?? "{}"));
      if (payload.queryStaticShadowData) {
        this.probed.push(host);
      }

      const device = this.devices[host];
      if (!device) {
        throw new Error("connect ECONNREFUSED");
      }

      if (payload.queryStaticShadowData) {
        return json(device.info);
      }

      if (!payload.queryDynamicShadowData) {
        this.changes.push({ host, ...payload });
        Object.assign(device.state, payload);
      }

      return json(device.state);
    };
  }
}

function json(data) {
  return { ok: true, status: 200, statusText: "OK", json: async () => data };
}

export function createPlatform({ config = {}, fans = new FakeFans(), advertised = [HOST], subnet = [], timing = {} } = {}) {
  globalThis.fetch = fans.fetch;
  const { messages, logger } = createLog();
  const api = createApi();
  const sweeps = [];
  const platform = new GoWacFansPlatform(logger, { platform: "GoWacFans", ...config }, api, {
    browse: async () => {
      if (advertised instanceof Error) {
        throw advertised;
      }

      return typeof advertised === "function" ? advertised() : advertised;
    },
    subnet: () => {
      sweeps.push(subnet);
      return subnet;
    },
    timing: { ...FAST_TIMING, ...timing }
  });
  return { api, fans, messages, platform, sweeps };
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
        Brightness: { name: "Brightness" },
        FirmwareRevision: { name: "FirmwareRevision" },
        Manufacturer: { name: "Manufacturer" },
        Model: { name: "Model" },
        Name: { name: "Name" },
        On: { name: "On" },
        RotationDirection: { name: "RotationDirection" },
        RotationSpeed: { name: "RotationSpeed" },
        SerialNumber: { name: "SerialNumber" }
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
        Lightbulb: "Lightbulb"
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
