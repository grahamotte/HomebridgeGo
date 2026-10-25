import type { PlatformConfig } from "homebridge";

export interface Settings {
  readonly hosts: readonly string[];
}

const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/u;

export function parseConfig(config: PlatformConfig): { settings: Settings; problems: readonly string[] } {
  const problems: string[] = [];
  const hosts: string[] = [];
  const entries: unknown[] = Array.isArray(config.hosts) ? config.hosts : [];
  for (const entry of entries) {
    const host = typeof entry === "string" ? entry.trim() : "";
    if (!HOST_PATTERN.test(host)) {
      problems.push(`Ignoring invalid host ${JSON.stringify(entry)}.`);
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }

  return { settings: { hosts }, problems };
}
