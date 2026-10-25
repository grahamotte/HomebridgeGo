import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPlatform, FakePlatformAccessory, FakeThermostats, HOST, info, settle, USN } from "./fakes.mjs";

const UUID = `uuid:ssdp:${USN}`;
const originalFetch = globalThis.fetch;
let running;

afterEach(() => {
  running?.platform.stop();
  running = undefined;
  globalThis.fetch = originalFetch;
});

function start(options) {
  running = createPlatform(options);
  return running;
}

describe("GoVenstarPlatform", () => {
  it("adds thermostats found with SSDP", async () => {
    const { api, messages, platform } = start();
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered.map((accessory) => [accessory.displayName, accessory.UUID]), [["Hallway", UUID]]);
    assert.deepEqual(api.registered[0].context.device, {
      id: `ssdp:${USN}`,
      host: HOST,
      name: "Hallway",
      serialNumber: "00:9D:6B:A0:67:6B"
    });
    assert.deepEqual(messages.info, [`Adding thermostat Hallway at ${HOST}.`]);
    assert.deepEqual(messages.warn, []);
  });

  it("restores cached thermostats once and keeps ones discovery misses", async () => {
    const { api, messages, platform } = start({ ssdp: [] });
    const cached = new FakePlatformAccessory("Hallway", UUID);
    cached.context.device = { id: `ssdp:${USN}`, host: HOST, name: "Hallway", serialNumber: "00:9D:6B:A0:67:6B" };
    platform.configureAccessory(cached);
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.deepEqual(api.unregistered, []);
    assert.deepEqual(messages.info, []);
    assert.deepEqual(messages.warn, []);
    assert.equal(cached.getService("Thermostat").getCharacteristic({ name: "CurrentTemperature" }).value, 21.11);
  });

  it("logs a restored thermostat the first time discovery finds it", async () => {
    const { api, messages, platform } = start();
    const cached = new FakePlatformAccessory("Hallway", UUID);
    platform.configureAccessory(cached);
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.equal(api.updated.length, 2);
    assert.deepEqual(messages.info, [`Restored thermostat Hallway at ${HOST}.`]);
  });

  it("reuses accessories cached under older host-based UUIDs", async () => {
    const { api, platform } = start();
    const legacy = new FakePlatformAccessory("Hallway", `uuid:${HOST}`);
    platform.configureAccessory(legacy);
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.equal(legacy.context.device.id, `ssdp:${USN}`);
  });

  it("probes configured hosts and reports invalid ones", async () => {
    const thermostats = new FakeThermostats({ "192.168.1.30": info({ name: "Office" }) });
    const { api, messages, platform } = start({ config: { hosts: ["192.168.1.30", "not a host"] }, ssdp: [], thermostats });
    platform.start();
    await platform.refresh();

    assert.deepEqual(messages.error, ["Ignoring invalid host \"not a host\"."]);
    assert.deepEqual(api.registered.map((accessory) => accessory.context.device), [
      { id: "host:192.168.1.30", host: "192.168.1.30", name: "Office", serialNumber: "host:192.168.1.30" }
    ]);
  });

  it("follows a thermostat SSDP finds at a new address", async () => {
    const thermostats = new FakeThermostats({ "192.168.1.31": info() });
    const { api, messages, platform } = start({ ssdp: [{ location: "http://192.168.1.31/", usn: USN }], thermostats });
    const cached = new FakePlatformAccessory("Hallway", UUID);
    cached.context.device = { id: `ssdp:${USN}`, host: HOST, name: "Hallway", serialNumber: "00:9D:6B:A0:67:6B" };
    platform.configureAccessory(cached);
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.equal(cached.context.device.host, "192.168.1.31");
    assert.deepEqual(messages.info, [`Hallway moved from ${HOST} to 192.168.1.31.`, "Restored thermostat Hallway at 192.168.1.31."]);
  });

  it("keeps the identity of a thermostat first added by address", async () => {
    const { api, platform } = start({ config: { hosts: [HOST] }, ssdp: [] });
    const cached = new FakePlatformAccessory("Hallway", `uuid:host:${HOST}`);
    cached.context.device = { id: `host:${HOST}`, host: HOST, name: "Hallway", serialNumber: `host:${HOST}` };
    platform.configureAccessory(cached);
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.equal(cached.context.device.id, `host:${HOST}`);
  });

  it("warns once when no thermostat can be found", async () => {
    const { messages, platform } = start({ ssdp: new Error("bind EADDRINUSE") });
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(messages.warn, [
      "SSDP discovery failed: bind EADDRINUSE",
      "No Venstar thermostat found. Check that local API access is on, or set hosts if SSDP is blocked on this network."
    ]);
    assert.deepEqual(messages.debug, ["SSDP discovery failed: bind EADDRINUSE"]);
  });

  it("runs one discovery at a time and stops on shutdown", async () => {
    const { api, platform, searches } = start();
    api.emit("didFinishLaunching");
    const first = platform.refresh();
    assert.equal(platform.refresh(), first);
    await first;
    assert.equal(searches.length, 1);

    api.emit("shutdown");
    await platform.refresh();
    await settle();
    assert.equal(searches.length, 2);
    assert.equal(api.registered.length, 1);
  });
});
