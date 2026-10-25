import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPlatform, FakeFans, FakePlatformAccessory, HOST, info, state, until } from "./fakes.mjs";

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
  await until(() => characteristic("Fanv2", "Active").value !== undefined);
  return { ...running, accessory, characteristic };
}

describe("FanAccessory", () => {
  it("exposes a light only for fans that have one", async () => {
    const fans = new FakeFans({ [HOST]: { info: info({ lightType: "" }), state: state() } });
    const { accessory } = await added({ fans });

    assert.equal(accessory.getService("Lightbulb"), undefined);
    assert.equal(accessory.getService("AccessoryInformation").getCharacteristic({ name: "SerialNumber" }).value, "00:11:22:33:44:55");
  });

  it("answers reads from cached state without waiting for a slow fan", async (t) => {
    const { characteristic } = await added();
    let requests = 0;
    globalThis.fetch = () => {
      requests += 1;
      return new Promise(() => undefined);
    };
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 60000);

    assert.equal(await characteristic("Fanv2", "Active").getHandler(), 0);
    assert.equal(requests, 1);
  });

  it("reports a communication failure when no state is cached", async () => {
    running = createPlatform({ advertised: [], fans: new FakeFans({}) });
    const cached = new FakePlatformAccessory("Center", "uuid:MF_1");
    cached.context.device = { ...info(), host: HOST };
    running.platform.configureAccessory(cached);
    running.platform.start();

    await assert.rejects(cached.getService("Fanv2").getCharacteristic({ name: "Active" }).getHandler(), running.api.hap.HapStatusError);
  });

  it("logs an unreachable fan once and its recovery once", async (t) => {
    const fans = new FakeFans();
    const { characteristic, messages } = await added({ fans });
    const device = fans.devices[HOST];
    const handler = characteristic("Fanv2", "Active").getHandler;
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    delete fans.devices[HOST];

    now += 10000;
    await handler();
    await until(() => messages.warn.length === 1);
    now += 10000;
    await handler();
    await until(() => messages.debug.some((message) => message.startsWith("Center: still unreachable")));
    fans.devices[HOST] = device;
    now += 10000;
    await handler();
    await until(() => messages.info.includes("Center: reachable again"));

    assert.deepEqual(messages.warn, ["Center: unreachable: Fan request failed: connect ECONNREFUSED"]);
  });

  it("turns the fan on at its last speed", async () => {
    const { characteristic, fans, messages } = await added();
    await characteristic("Fanv2", "Active").setHandler(1);

    assert.deepEqual(fans.changes, [{ host: HOST, fanOn: true, fanSpeed: 1 }]);
    assert.equal(characteristic("Fanv2", "RotationSpeed").value, 100 / 6);
    assert.ok(messages.info.includes("Center: setting fanOn true, fanSpeed 1"));
  });

  it("rejects a write with a communication failure when the fan is unreachable", async () => {
    const { api, characteristic, fans } = await added();
    delete fans.devices[HOST];

    await assert.rejects(characteristic("Lightbulb", "On").setHandler(true), api.hap.HapStatusError);
  });
});
