import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPlatform, FakePlatformAccessory, FakeThermostats, HOST, info, until } from "./fakes.mjs";

const originalFetch = globalThis.fetch;
let running;

afterEach(() => {
  running?.platform.stop();
  running = undefined;
  globalThis.fetch = originalFetch;
});

async function added(options) {
  running = createPlatform(options);
  running.platform.start();
  await running.platform.refresh();
  const accessory = running.api.registered[0];
  const characteristic = (service, name) => accessory.getService(service).getCharacteristic({ name });
  await until(() => characteristic("Thermostat", "CurrentTemperature").value !== undefined);
  return { ...running, accessory, characteristic };
}

describe("ThermostatAccessory", () => {
  it("answers reads from cached state without waiting for a slow thermostat", async (t) => {
    const { characteristic } = await added();
    let requests = 0;
    globalThis.fetch = () => {
      requests += 1;
      return new Promise(() => undefined);
    };
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 60000);

    assert.equal(await characteristic("Thermostat", "TargetTemperature").getHandler(), 20);
    assert.equal(requests, 1);
  });

  it("reports a communication failure when no state is cached", async () => {
    running = createPlatform({ thermostats: new FakeThermostats({}), ssdp: [] });
    const cached = new FakePlatformAccessory("Hallway", "uuid:cached");
    cached.context.device = { id: "host:192.168.1.40", host: "192.168.1.40", name: "Hallway", serialNumber: "host:192.168.1.40" };
    running.platform.configureAccessory(cached);
    running.platform.start();
    const handler = cached.getService("Thermostat").getCharacteristic({ name: "CurrentTemperature" }).getHandler;

    await assert.rejects(handler(), running.api.hap.HapStatusError);
  });

  it("logs an unreachable thermostat once and its recovery once", async () => {
    const thermostats = new FakeThermostats();
    const { characteristic, messages } = await added({ thermostats });
    const handler = characteristic("Thermostat", "CurrentTemperature").getHandler;
    const reading = info();
    delete thermostats.devices[HOST];

    const later = Date.now() + 10000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      await handler();
      await until(() => messages.warn.length === 1);
      Date.now = () => later + 10000;
      await handler();
      await until(() => messages.debug.some((message) => message.startsWith("Hallway: still unreachable")));
      thermostats.devices[HOST] = reading;
      Date.now = () => later + 20000;
      await handler();
      await until(() => messages.info.includes("Hallway: reachable again"));
    } finally {
      Date.now = realNow;
    }

    assert.deepEqual(messages.warn, ["Hallway: unreachable: Failed to query thermostat info: connect ECONNREFUSED"]);
  });

  it("sends target temperature changes for the current mode", async () => {
    const { characteristic, messages, thermostats } = await added();
    await characteristic("Thermostat", "TargetTemperature").setHandler(21);

    assert.deepEqual(thermostats.controls, [{ host: HOST, mode: 1, fan: 0, heattemp: 69.8, cooltemp: 76 }]);
    assert.ok(messages.info.includes("Hallway: setting mode 1, fan 0, heat 69.8, cool 76"));
  });

  it("rejects a write with a communication failure when the thermostat is unreachable", async () => {
    const { api, characteristic, thermostats } = await added();
    delete thermostats.devices[HOST];

    await assert.rejects(characteristic("Thermostat", "TargetTemperature").setHandler(21), api.hap.HapStatusError);
  });
});
