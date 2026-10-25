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

Shared tooling lives at the root: `package.json` (devDependencies and the single `package-lock.json`), `eslint.config.js`, `tsconfig.base.json` (each package's `tsconfig.json` extends it), and `mise.toml`. Run `mise test` before every PR; it lints, builds, tests, and pack-checks every package. Publish one package with `mise publish PACKAGE`, such as `mise publish venstar`, after bumping its version.
