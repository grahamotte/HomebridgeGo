# AGENTS

For card work, use Mr. Moto's `mr` CLI: run `mr card claim <CARD>` and follow its output, and see `mr --help` for the rest.

This repository holds four Homebridge plugins as npm workspaces, each published to npm under its own name:

| Directory | npm package | Platform |
| --- | --- | --- |
| `packages/lutron` | `homebridge-go-lutron` | Lutron Caséta shades and Pico remotes over local LEAP |
| `packages/venstar` | `homebridge-go-venstar` | Venstar thermostats |
| `packages/wac` | `homebridge-go-wac-fans` | WAC and Modern Forms fans |
| `packages/yale` | `homebridge-go-yale` | Yale and August locks over local Bluetooth |

Never rename an npm package or a plugin's platform name: Homebridge keys installed configs and cached accessories on them.

Shared tooling lives at the root: `package.json` (devDependencies and the single `package-lock.json`), `eslint.config.js`, `tsconfig.base.json` (each package's `tsconfig.json` extends it), and `mise.toml`. Run `mise test` before every PR; it lints, builds, tests, and pack-checks every package. After bumping versions, run `mise publish` in a terminal: it pushes main, validates, and publishes every plugin whose version is not on npm yet, with npm's browser login and passkey prompts inline. `mise publish venstar` publishes just one.

## Plugin conventions

All four plugins follow the same shape. Keep new code and new plugins to it.

Layout of `src/`:

- `index.ts` registers the platform and nothing else.
- `settings.ts` holds `PLATFORM_NAME`, `PLUGIN_NAME`, protocol constants, and a `Timing` interface with `DEFAULT_TIMING`. Every duration is in milliseconds and ends in `Ms`.
- `config.ts` exports `parseConfig(config)`, returning `{ settings, problems }`. Problems are full sentences, which the platform logs at error. Bad entries are skipped, never fatal.
- `platform.ts` exports `Go<Name>Platform`, constructed as `(log, config, api, dependencies = {})`. `PlatformDependencies` is the test seam: injected discovery, transports, and `timing`.
- `accessory.ts` exports `<Device>Accessory`, one per HomeKit accessory, with `update(device)` and `stop()`. Lutron has two kinds, in `shade.ts` and `pico.ts`.
- `discovery.ts` finds devices. Device protocols and clients live in files named for the device or protocol.
- `log.ts` and `registry.ts` are shared, as is `test/shared.test.mjs`. Edit one copy, copy it to the other packages, and `npm run check:shared` will confirm they match.

Platform lifecycle:

- `configureAccessory` only hands the accessory to the `AccessoryRegistry`.
- `didFinishLaunching` calls `start()`. Discovering plugins first attach controllers to cached accessories so HomeKit works straight away, then run `refresh()` now and every `discoveryIntervalMs` on an unref'd timer. `refresh()` returns the in-flight pass instead of starting a second one.
- `shutdown` calls `stop()`, which clears every timer and stops every controller.
- Create accessories with `registry.obtain()`, set their context, attach the controller, then `registry.publish()`. Remove them with `registry.remove()`.
- Remove an accessory only when the source of truth says it is gone: the Lutron bridge, or the Yale config. Discovered devices that go missing stay cached.
- Never change how an accessory's UUID is generated; HomeKit automations and cached accessories depend on it.

Settings:

- Zero required settings wherever discovery works. The only common option is `hosts`, a list of addresses for networks where discovery cannot reach.
- Every `config.schema.json` has `name`, `singular`, `strictValidation`, and a `headerDisplay` saying how devices are found. User-facing durations are in seconds.

Logging:

- `info`: an accessory added, restored (once per run), or moved; a bridge connecting; a user's command and its result; recovery.
- `warn`: the first failure to reach a device (use `Reachability`), a failed command, a removal, and "nothing found" (once until something is found).
- `debug`: repeated failures, retries, polling, and discovery details.
- `error`: config problems and unexpected failures.
- Device messages are `Name: lowercase message` with no period. Platform messages are sentences ending in a period. Format errors with `describe(error)`.

HomeKit:

- Answer reads from the last known state and refresh in the background. With no state yet, throw `HapStatusError(SERVICE_COMMUNICATION_FAILURE)`, and throw the same for a failed write.

Tests:

- Each package has `test/fakes.mjs` with `createPlatform()`, `createApi()`, `createLog()`, `until()`, and `settle()`, and tests the platform, the accessories, and the protocol code against the built `dist/`.

Style: double quotes, semicolons, two-space indents, no trailing commas except in multi-line parameter lists. ESLint enforces these; run `npx eslint . --fix`.

Develop one plugin against a local Homebridge with `mise dev PACKAGE`, which uses `packages/PACKAGE/test/hbConfig/config.json`.
