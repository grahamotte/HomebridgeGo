import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPlatform, FakeFans, FakePlatformAccessory, HOST, info, settle, state } from "./fakes.mjs";

const UUID = "uuid:MF_1";
const DEVICE = { ...info(), host: HOST };
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

function cachedFan(platform, device = DEVICE) {
  const accessory = new FakePlatformAccessory(device.deviceName, UUID);
  accessory.context.device = { ...device, lastSeen: "2026-01-01T00:00:00.000Z" };
  platform.configureAccessory(accessory);
  return accessory;
}

describe("GoWacFansPlatform", () => {
  it("adds fans advertised over Bonjour", async () => {
    const { api, messages, platform, sweeps } = start();
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered.map((accessory) => [accessory.displayName, accessory.UUID, accessory.context.device]), [["Center", UUID, DEVICE]]);
    assert.deepEqual(messages.info, [`Adding fan Center at ${HOST}.`]);
    assert.deepEqual(sweeps, []);
  });

  it("restores a cached fan once and drops stale context fields", async () => {
    const { api, messages, platform } = start();
    const cached = cachedFan(platform);
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.deepEqual(cached.context.device, DEVICE);
    assert.deepEqual(messages.info, [`Restored fan Center at ${HOST}.`]);
  });

  it("finds cached and configured fans without Bonjour", async () => {
    const fans = new FakeFans({
      [HOST]: { info: info(), state: state() },
      "192.168.1.221": { info: info({ clientId: "MF_2", deviceName: "Porch" }), state: state({ clientId: "MF_2" }) }
    });
    const { api, platform, sweeps } = start({ advertised: [], config: { hosts: ["192.168.1.221"] }, fans });
    cachedFan(platform);
    platform.start();
    await platform.refresh();

    assert.deepEqual(api.registered.map((accessory) => accessory.displayName), ["Porch"]);
    assert.deepEqual(sweeps, []);
  });

  it("sweeps the local network for a missing fan at most once per interval", async () => {
    const fans = new FakeFans({ "192.168.1.240": { info: info(), state: state() } });
    const { messages, platform, sweeps } = start({ advertised: [], fans, subnet: ["192.168.1.239", "192.168.1.240"] });
    const cached = cachedFan(platform);
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.equal(sweeps.length, 1);
    assert.equal(cached.context.device.host, "192.168.1.240");
    assert.ok(messages.info.includes(`Center moved from ${HOST} to 192.168.1.240.`));
  });

  it("keeps a fan that cannot be found and warns once when none exist", async () => {
    const { api, messages, platform } = start({ advertised: [], fans: new FakeFans({}) });
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(api.registered, []);
    assert.deepEqual(messages.warn, ["No WAC fan found. Set hosts if the fans are on another network."]);
  });

  it("warns once when Bonjour fails", async () => {
    const { messages, platform } = start({ advertised: new Error("socket closed") });
    platform.start();
    await platform.refresh();
    await platform.refresh();

    assert.deepEqual(messages.warn, [
      "Bonjour discovery failed: socket closed",
      "No WAC fan found. Set hosts if the fans are on another network."
    ]);
    assert.deepEqual(messages.debug.filter((message) => message.startsWith("Bonjour")), ["Bonjour discovery failed: socket closed"]);
  });

  it("stops discovering after shutdown", async () => {
    const { api, platform } = start();
    api.emit("didFinishLaunching");
    api.emit("shutdown");
    await platform.refresh();
    await settle();

    assert.deepEqual(api.registered, []);
  });
});
