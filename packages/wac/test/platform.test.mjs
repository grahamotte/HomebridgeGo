import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverFans } from "../dist/discovery.js";
import { GoWacFansPlatform } from "../dist/platform.js";

const fan = {
  clientId: "fan-1",
  mac: "00:11:22:33:44:55",
  deviceName: "center",
  fanType: "Ceiling Fan",
  firmwareVersion: "1.0.0",
  lightType: "dimmer",
  host: "192.168.1.220"
};

const fanState = {
  clientId: fan.clientId,
  fanOn: false,
  fanSpeed: 1,
  fanDirection: "forward",
  lightOn: false,
  lightBrightness: 100
};

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GoWacFansPlatform discovery logging", () => {
  it("logs initial discovery at info and unchanged rediscovery at debug", async () => {
    installFetchMock();
    const { log, platform } = createPlatform();

    await platform.discoverDevices();
    await flushPromises();

    assert.deepEqual(log.info, [
      "Discovering WAC fans...",
      "Adding fan center at 192.168.1.220.",
      "WAC discovery finished: 1 fan(s) available."
    ]);

    clearLog(log);

    await platform.discoverDevices();
    await flushPromises();

    assert.deepEqual(log.info, []);
    assert.deepEqual(log.warn, []);
    assert.deepEqual(log.debug, [
      "Discovering WAC fans...",
      "WAC discovery finished: 1 fan(s) available."
    ]);
  });

  it("logs only when a cached fan becomes unavailable or recovers", async () => {
    let staticInfoAvailable = true;
    installFetchMock(() => staticInfoAvailable);
    const { log, platform } = createPlatform();

    await platform.discoverDevices();
    await flushPromises();
    clearLog(log);

    staticInfoAvailable = false;
    await platform.discoverDevices();
    await flushPromises();

    assert.deepEqual(log.warn, [
      "Keeping cached fan center; it was not discovered this run."
    ]);
    assert.deepEqual(log.info, [
      "WAC discovery finished: 0 fan(s) available."
    ]);

    clearLog(log);

    await platform.discoverDevices();
    await flushPromises();

    assert.deepEqual(log.info, []);
    assert.deepEqual(log.warn, []);
    assert.deepEqual(log.debug, [
      "Discovering WAC fans...",
      "WAC discovery finished: 0 fan(s) available."
    ]);

    clearLog(log);
    staticInfoAvailable = true;

    await platform.discoverDevices();
    await flushPromises();

    assert.deepEqual(log.info, [
      "Fan center is available again at 192.168.1.220.",
      "WAC discovery finished: 1 fan(s) available."
    ]);
    assert.deepEqual(log.warn, []);
  });
});

describe("WacFanAccessory reads", () => {
  it("serves cached values without waiting for a slow fan", async (t) => {
    installFetchMock();
    const { platform } = createPlatform();
    await platform.discoverDevices();
    await new Promise((resolve) => setImmediate(resolve));

    let requests = 0;
    globalThis.fetch = () => {
      requests += 1;
      return new Promise(() => undefined);
    };
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 60000);

    assert.equal(await readCharacteristic(platform, "Active"), 0);
    assert.equal(requests, 1);
  });

  it("reports a HomeKit communication failure when no state is cached", async () => {
    globalThis.fetch = async (_url, init) => {
      if (JSON.parse(String(init?.body ?? "{}")).queryStaticShadowData) {
        return jsonResponse(fan);
      }

      throw new Error("This operation was aborted");
    };
    const { platform } = createPlatform();
    await platform.discoverDevices();
    await new Promise((resolve) => setImmediate(resolve));

    await assert.rejects(readCharacteristic(platform, "Active"), platform.api.hap.HapStatusError);
  });
});

function readCharacteristic(platform, name) {
  return platform.accessories.get(`uuid:${fan.clientId}`).getService("Fanv2").getCharacteristic(name).getHandler();
}

function installFetchMock(staticInfoAvailable = () => true) {
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));

    if (payload.queryStaticShadowData) {
      if (!staticInfoAvailable()) {
        throw new Error("Fan unavailable");
      }

      return jsonResponse(fan);
    }

    return jsonResponse(fanState);
  };
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data
  };
}

function createPlatform() {
  const log = createLogMessages();
  const api = createApi();
  const platform = new GoWacFansPlatform(createLogger(log), { platform: "GoWacFans" }, api);
  platform.findFans = (cachedHosts) => discoverFans([fan.host, ...cachedHosts], 1000, false);

  return { log, platform };
}

function createLogMessages() {
  return {
    debug: [],
    error: [],
    info: [],
    warn: []
  };
}

function createLogger(log) {
  return {
    debug: (...messages) => log.debug.push(format(messages)),
    error: (...messages) => log.error.push(format(messages)),
    info: (...messages) => log.info.push(format(messages)),
    warn: (...messages) => log.warn.push(format(messages))
  };
}

function clearLog(log) {
  log.debug.length = 0;
  log.error.length = 0;
  log.info.length = 0;
  log.warn.length = 0;
}

function format(messages) {
  return messages.join(" ");
}

function createApi() {
  return {
    hap: {
      Characteristic: {
        Active: "Active",
        Brightness: "Brightness",
        FirmwareRevision: "FirmwareRevision",
        Manufacturer: "Manufacturer",
        Model: "Model",
        Name: "Name",
        On: "On",
        RotationDirection: "RotationDirection",
        RotationSpeed: "RotationSpeed",
        SerialNumber: "SerialNumber"
      },
      HAPStatus: {
        SERVICE_COMMUNICATION_FAILURE: -70402
      },
      HapStatusError: class HapStatusError extends Error {},
      Service: {
        AccessoryInformation: "AccessoryInformation",
        Fanv2: "Fanv2",
        Lightbulb: "Lightbulb"
      },
      uuid: {
        generate: (value) => `uuid:${value}`
      }
    },
    on: () => undefined,
    platformAccessory: FakePlatformAccessory,
    registerPlatformAccessories: () => undefined,
    unregisterPlatformAccessories: () => undefined
  };
}

class FakePlatformAccessory {
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

  getCharacteristic(name) {
    if (!this.characteristics.has(name)) {
      this.characteristics.set(name, new FakeCharacteristic());
    }

    return this.characteristics.get(name);
  }

  setCharacteristic(name, value) {
    this.getCharacteristic(name).value = value;
    return this;
  }
}

class FakeCharacteristic {
  onGet(handler) {
    this.getHandler = handler;
    return this;
  }

  onSet() {
    return this;
  }

  setProps() {
    return this;
  }

  updateValue(value) {
    this.value = value;
    return this;
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
