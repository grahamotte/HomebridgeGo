// Shared by every plugin in this repository. Keep the copies identical; `npm run check:shared` enforces it.
import type { Logging } from "homebridge";

export type Log = Pick<Logging, "debug" | "info" | "warn" | "error">;

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reports a device going offline once at warn, repeats at debug, and the recovery once at info,
// so a device that stays offline does not flood the log on every poll or reconnect.
export class Reachability {
  private down = false;

  constructor(
    private readonly log: Log,
    private readonly name: string,
  ) {}

  get isDown(): boolean {
    return this.down;
  }

  failed(error: unknown): void {
    if (this.down) {
      this.log.debug(`${this.name}: still unreachable: ${describe(error)}`);
      return;
    }

    this.down = true;
    this.log.warn(`${this.name}: unreachable: ${describe(error)}`);
  }

  succeeded(): void {
    if (this.down) {
      this.down = false;
      this.log.info(`${this.name}: reachable again`);
    }
  }
}
