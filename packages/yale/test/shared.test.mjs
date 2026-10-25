// Shared by every plugin in this repository. Keep the copies identical; `npm run check:shared` enforces it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describe as describeError, Reachability } from "../dist/log.js";
import { AccessoryRegistry } from "../dist/registry.js";

function createLog() {
  const messages = { debug: [], error: [], info: [], warn: [] };
  const logger = Object.fromEntries(Object.keys(messages).map((level) => [level, (message) => messages[level].push(message)]));
  return { messages, logger };
}

class Accessory {
  constructor(displayName, UUID) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.context = {};
  }
}

function createApi() {
  const api = {
    hap: { uuid: { generate: (value) => `uuid:${value}` } },
    platformAccessory: Accessory,
    registered: [],
    unregistered: [],
    updated: [],
    registerPlatformAccessories: (plugin, platform, accessories) => api.registered.push([plugin, platform, ...accessories]),
    unregisterPlatformAccessories: (plugin, platform, accessories) => api.unregistered.push([plugin, platform, ...accessories]),
    updatePlatformAccessories: (accessories) => api.updated.push(...accessories)
  };
  return api;
}

describe("describe", () => {
  it("formats errors and other values", () => {
    assert.equal(describeError(new Error("boom")), "boom");
    assert.equal(describeError("plain"), "plain");
  });
});

describe("Reachability", () => {
  it("warns once, repeats at debug, and logs the recovery once", () => {
    const { messages, logger } = createLog();
    const reachability = new Reachability(logger, "Hall");
    reachability.succeeded();
    reachability.failed(new Error("timed out"));
    reachability.failed(new Error("refused"));
    assert.equal(reachability.isDown, true);
    reachability.succeeded();
    reachability.succeeded();

    assert.deepEqual(messages.warn, ["Hall: unreachable: timed out"]);
    assert.deepEqual(messages.debug, ["Hall: still unreachable: refused"]);
    assert.deepEqual(messages.info, ["Hall: reachable again"]);
    assert.equal(reachability.isDown, false);
  });
});

describe("AccessoryRegistry", () => {
  it("registers new accessories and restores cached ones once", () => {
    const { messages, logger } = createLog();
    const api = createApi();
    const registry = new AccessoryRegistry(api, logger, "plugin", "Platform");
    const cached = new Accessory("Hall", "uuid:hall");
    registry.configure(cached);

    assert.equal(registry.obtain(registry.uuid("hall"), "Hall"), cached);
    registry.publish(cached, "device Hall");
    registry.publish(cached, "device Hall");
    const added = registry.obtain(registry.uuid("porch"), "Porch");
    assert.equal(registry.has(added.UUID), false);
    registry.publish(added, "device Porch");

    assert.deepEqual(api.registered, [["plugin", "Platform", added]]);
    assert.deepEqual(api.updated, [cached, cached]);
    assert.deepEqual(registry.all(), [cached, added]);
    assert.deepEqual(messages.info, ["Restored device Hall.", "Adding device Porch."]);
  });

  it("removes accessories", () => {
    const { messages, logger } = createLog();
    const api = createApi();
    const registry = new AccessoryRegistry(api, logger, "plugin", "Platform");
    const cached = new Accessory("Hall", "uuid:hall");
    registry.configure(cached);
    registry.remove(cached, "device Hall", "it is gone");

    assert.deepEqual(api.unregistered, [["plugin", "Platform", cached]]);
    assert.equal(registry.get("uuid:hall"), undefined);
    assert.deepEqual(messages.warn, ["Removing device Hall; it is gone."]);
  });
});
