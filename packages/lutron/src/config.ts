import net from "node:net";
import type { PlatformConfig } from "homebridge";

export interface Settings {
  readonly hosts: readonly string[];
}

const HOST_PATTERN = /^[A-Za-z0-9.-]+$/u;

export function parseConfig(config: PlatformConfig): { settings: Settings; problems: readonly string[] } {
  const problems: string[] = [];
  const hosts: string[] = [];
  // Versions before 0.3 took a single `host`; it still works alongside `hosts`.
  const entries: unknown[] = [...(Array.isArray(config.hosts) ? config.hosts : []), ...(config.host === undefined ? [] : [config.host])];
  for (const entry of entries) {
    const host = typeof entry === "string" ? entry.trim() : "";
    if (!host && typeof entry === "string") {
      continue;
    }

    if (!net.isIP(host) && !HOST_PATTERN.test(host)) {
      problems.push(`Ignoring invalid host ${JSON.stringify(entry)}.`);
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }

  return { settings: { hosts }, problems };
}
