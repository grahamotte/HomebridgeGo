import net from "node:net";
import os from "node:os";
import { Bonjour, type Service } from "bonjour-service";
import { BONJOUR_TYPE } from "./settings.js";
import { WacClient, type FanInfo } from "./wac.js";

export interface Fan extends FanInfo {
  readonly host: string;
}

export type Browse = (timeoutMs: number) => Promise<string[]>;

const PROBE_CONCURRENCY = 48;

// Lists the hosts advertising the fans' Bonjour service.
export const browseFans: Browse = async (timeoutMs) => {
  const hosts = new Set<string>();
  const bonjour = new Bonjour(undefined, () => undefined);
  try {
    const browser = bonjour.find({ type: BONJOUR_TYPE, protocol: "tcp" });
    // Prefer IPv4 addresses: many Homebridge hosts cannot resolve .local names.
    browser.on("up", (service: Service) => {
      const addresses = (service.addresses ?? []).filter((address) => net.isIPv4(address));
      const name = service.host?.endsWith(".") ? service.host.slice(0, -1) : service.host;
      for (const host of addresses.length > 0 ? addresses : [name]) {
        if (host) {
          hosts.add(host);
        }
      }
    });
    const timer = setInterval(() => browser.update(), Math.min(timeoutMs, 1000));
    timer.unref?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref?.();
    });
    clearInterval(timer);
    browser.stop();
  } finally {
    bonjour.destroy();
  }

  return [...hosts];
};

// Asks each host for its fan details and returns the fans that answered, keyed by client ID.
export async function probeFans(hosts: readonly string[], timeoutMs: number): Promise<Fan[]> {
  const candidates = [...new Set(hosts)];
  const found = new Map<string, Fan>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, async () => {
    while (next < candidates.length) {
      const host = candidates[next];
      next += 1;
      try {
        const info = await new WacClient(host, timeoutMs).getInfo();
        if (info.clientId) {
          found.set(info.clientId, { ...info, host });
        }
      } catch {
        // Most probed hosts are not fans, or are fans that are switched off.
      }
    }
  }));
  return [...found.values()];
}

// Every address on the local /24 networks, for when Bonjour cannot find a fan.
export function subnetHosts(): string[] {
  const hosts = new Set<string>();
  for (const address of Object.values(os.networkInterfaces()).flat()) {
    if (!address || address.family !== "IPv4" || address.internal) {
      continue;
    }

    const octets = address.address.split(".");
    for (let index = 1; index < 255; index += 1) {
      hosts.add(`${octets[0]}.${octets[1]}.${octets[2]}.${index}`);
    }
  }

  return [...hosts];
}
