# Development

## Source layout

| Path | Role |
| --- | --- |
| `tauri/casepilot/apps/web` | React renderer and Playwright scenarios |
| `tauri/casepilot/packages/ui` | Shared UI components and tokens |
| `tauri/casepilot/src-tauri` | Rust desktop host, native integration, and package configuration |
| `tauri/runtime` | Node operation engine and its tests |
| `tauri/scripts` and `tauri/shared` | Desktop launcher, engine bundling, and shared definitions |
| `electron`, `src`, `tests`, and `qt` | Earlier desktop implementations and their tests |

## Install and build

Use Node.js 24, the pnpm version declared in `tauri/casepilot/package.json`, and a Rust toolchain. Apple Silicon macOS setup is in [Getting started](Getting-Started.md#apple-silicon-macos).

On Ubuntu 24.04, install the native build dependencies:

```sh
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libdbus-1-dev
```

Run the install and build from the repository root:

```sh
npm ci
pnpm --dir tauri/runtime install --frozen-lockfile
pnpm --dir tauri/casepilot install --frozen-lockfile
npm run package:linux
```

Find the `.deb` under `tauri/casepilot/src-tauri/target/release/bundle/deb/`. Use `npm run dev` to launch the Tauri development app after installing the native dependencies.

## Run offline checks

```sh
npm run test:tauri
pnpm --dir tauri/casepilot lint
pnpm --dir tauri/casepilot typecheck
pnpm --dir tauri/casepilot build
pnpm --dir tauri/casepilot --filter web exec playwright install chromium
pnpm --dir tauri/casepilot --filter web test:e2e
```

Run `npm test` for the legacy Electron suite or `xvfb-run --auto-servernum npm test` on headless Linux. CI uses `CASEPILOT_ELECTRON_TEST_NO_SANDBOX=1` for the isolated Electron test processes where sandbox namespaces may be unavailable.

Playwright serves the production renderer, substitutes the Tauri IPC bridge, and fails on unexpected off-server requests. Native CI builds the macOS and Linux packages and checks launch, workspace navigation, Node sidecar startup, and session isolation with a temporary profile. Use synthetic fixtures in tests and sanitized evidence in pull requests.

## Merge into the default branch

Open a pull request and run CI against the latest default branch before merging. GitHub requires the five jobs in [the main branch ruleset](../../.github/rulesets/main-ci.json) from GitHub Actions. Repository admins can bypass the checks on a pull request for an authorized emergency fix.

If a required job needs a new name, coordinate the CI and repository ruleset changes so a check can run under both names during the transition. Verify the active rules in [repository settings](https://github.com/rowkavdev/AltCrate/rulesets).

[CI runs](https://github.com/rowkavdev/AltCrate/actions/workflows/ci.yml) · [Back to the handbook](Home.md)
