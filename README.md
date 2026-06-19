# depup

Check npm/pnpm dependencies for available updates — with support for custom and scoped private registries, pnpm monorepos, and pnpm v11.

## Features

- **Outdated check** — compares each dependency's spec against the latest version on its registry and classifies the update as `major`, `minor`, or `patch`.
- **Private & scoped registries** — resolves per-scope registries (e.g. `@myorg` → GitHub Packages) the same way npm/pnpm do, by reading `.npmrc` (user, root, and per-package) and `pnpm-workspace.yaml`.
- **pnpm v11 support** — pnpm v11 moved registry config out of `.npmrc` into `pnpm-workspace.yaml`, and moved the primary auth token store to a separate `auth.ini` file. depup reads both, with the same priority order pnpm itself uses (project `.npmrc` > `auth.ini` > user `.npmrc` > pnpm-workspace registries as fallback for unscoped lookups).
- **Monorepo / workspace mode** (`-w`) — auto-discovers sub-packages from `pnpm-workspace.yaml` or npm/yarn `workspaces` in `package.json` and checks all of them.
- **Auto-update** (`-u`) — writes the resolved latest version straight back into `package.json`, preserving the original range style (`^`, `~`, or exact pin).
- **Flexible dependency selection** — include/exclude `devDependencies`, `peerDependencies`, `optionalDependencies`, or filter by name.
- **JSON output** (`--json`) for scripting/CI.
- Skips local/linked dependencies (`workspace:`, `link:`, `file:`, git URLs) since they aren't resolvable against a registry.

## Installation

```bash
pnpm add -g depup
```

Or run locally in this repo:

```bash
pnpm build
node dist/index.js --path /path/to/project
```

## Usage

```bash
depup [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `-p, --path <path>` | Project directory to check | `.` |
| `-r, --registry <url>` | Override registry URL for all packages | — |
| `-w, --workspace` | Monorepo mode: scan all sub-packages from `pnpm-workspace.yaml` or `package.json#workspaces` | `false` |
| `--include-dev` / `--no-include-dev` | Include/exclude `devDependencies` | included |
| `--include-peer` | Include `peerDependencies` | `false` |
| `--include-optional` | Include `optionalDependencies` | `false` |
| `-f, --filter <pattern>` | Only check packages whose name contains this string | — |
| `-a, --all` | Show all packages, not only outdated ones | `false` |
| `-u, --update` | Write resolved latest versions back into `package.json` (only for `^`, `~`, and exact specs) | `false` |
| `--json` | Output results as JSON | `false` |
| `-c, --concurrency <n>` | Concurrent registry requests | `10` |

### Examples

Check the current directory:

```bash
depup
```

Check a pnpm monorepo, including peer dependencies:

```bash
depup -p ../my-monorepo -w --include-peer
```

Apply all resolved updates directly to `package.json`:

```bash
depup -u
```

Only check packages matching a pattern, as JSON:

```bash
depup -f @myorg --json
```

## How registries are resolved

For each dependency, depup determines the registry in this order:

1. `--registry` CLI override, if given.
2. A scoped registry for the package (e.g. `@myorg/*`), from either:
   - `<scope>:registry` in `.npmrc` (user `~/.npmrc`, project root `.npmrc`, or per-package `.npmrc`), or
   - `registries` in `pnpm-workspace.yaml`.
3. The default registry (`registry` in `.npmrc`, or `https://registry.npmjs.org`).

Auth tokens are looked up by registry host across:

1. Project-level `.npmrc`
2. pnpm's `auth.ini` (`~/.config/pnpm`, `~/Library/Preferences/pnpm`, or `%LOCALAPPDATA%\pnpm\config`, depending on OS — written by `pnpm login`)
3. User-level `~/.npmrc` (fallback)

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
```
