import dgram from "node:dgram";
import { describe, type Log } from "./log.js";
import { VenstarClient } from "./venstar.js";

export interface Thermostat {
  readonly id: string;
  readonly host: string;
  readonly name: string;
  readonly serialNumber: string;
}

export interface SsdpDevice {
  readonly location: string;
  readonly usn?: string;
}

export type SsdpSearch = (searchTarget: string, timeoutMs: number) => Promise<SsdpDevice[]>;

interface Candidate {
  readonly host: string;
  readonly usn?: string;
}

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SERIAL_NUMBER_MAX_LENGTH = 64;
const MAC_ADDRESS_PATTERN = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/iu;

// Probes every SSDP response and configured host, and returns the thermostats that answered.
export async function probeThermostats(
  ssdp: readonly SsdpDevice[],
  hosts: readonly string[],
  requestTimeoutMs: number,
  log: Log,
): Promise<Thermostat[]> {
  const candidates = new Map<string, Candidate>();
  for (const device of ssdp) {
    const host = hostFromLocation(device.location);
    if (host) {
      candidates.set(host, { host, usn: device.usn });
    }
  }

  for (const host of hosts.map(normalizeHost)) {
    if (host && !candidates.has(host)) {
      candidates.set(host, { host });
    }
  }

  const found = await Promise.all([...candidates.values()].map(async ({ host, usn }) => {
    try {
      const info = await new VenstarClient(host, requestTimeoutMs).getInfo();
      const id = usn ? `ssdp:${usn}` : `host:${host}`;
      return { id, host, name: info.name, serialNumber: serialNumber(id, usn) };
    } catch (error) {
      log.debug(`No thermostat answered at ${host}: ${describe(error)}`);
      return undefined;
    }
  }));
  return found.filter((thermostat) => thermostat !== undefined);
}

export function serialNumber(id: string, usn?: string): string {
  const mac = usn?.match(MAC_ADDRESS_PATTERN)?.[0];
  return mac ? mac.toUpperCase() : id.slice(0, SERIAL_NUMBER_MAX_LENGTH);
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).host;
  } catch {
    return trimmed.replace(/^https?:\/\//u, "").split("/")[0] ?? "";
  }
}

export function hostnameOnly(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
}

function hostFromLocation(location: string): string {
  try {
    return normalizeHost(new URL(location).host);
  } catch {
    return "";
  }
}

export const searchSsdp: SsdpSearch = async (searchTarget, timeoutMs) => {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const devices = new Map<string, SsdpDevice>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(() => finish(), timeoutMs);

    socket.on("message", (message) => {
      const device = parseSsdpResponse(message);
      if (device) {
        devices.set(device.usn ?? device.location, device);
      }
    });
    socket.on("error", finish);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(2);
      socket.send(searchMessage(searchTarget), SSDP_PORT, SSDP_ADDRESS, (error) => {
        if (error) {
          finish(error);
        }
      });
    });
  });

  return [...devices.values()];
};

function searchMessage(searchTarget: string): Buffer {
  return Buffer.from([
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    "MAN: \"ssdp:discover\"",
    "MX: 2",
    `ST: ${searchTarget}`,
    "",
    ""
  ].join("\r\n"));
}

export function parseSsdpResponse(message: Buffer): SsdpDevice | undefined {
  const headers = new Map<string, string>();
  for (const line of message.toString("utf8").split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator !== -1) {
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }

  const location = headers.get("location");
  return location ? { location, usn: headers.get("usn") } : undefined;
}
