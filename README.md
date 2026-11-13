# AltCrate

Source code for the CasePilot desktop application. The current interface uses
Tauri 2, React, Vite and Radix UI; the operation engine runs in Node.js.
The earlier Electron and Qt implementations are retained in this repository.

## Requirements

- Node.js 24 and npm. CI reads the Node major from `.node-version`.
- pnpm, using the version declared in `tauri/casepilot/package.json`.
- Rust and the native build tools required by Tauri. macOS builds also require
  the Apple command line developer tools.

## Install and run on Apple Silicon macOS

```sh
npm ci
npm exec -- install-electron
pnpm --dir tauri/runtime install --frozen-lockfile
pnpm --dir tauri/casepilot install --frozen-lockfile
npm run dev
```

To build the macOS application and open the resulting local bundle:

```sh
npm run package:mac
npm start
```

The application still uses its existing CasePilot name. The local macOS bundle
is ad-hoc signed; this repository does not provide a notarized release.

## Offline checks

After installing the dependencies:

```sh
npm run test:tauri
pnpm --dir tauri/casepilot lint
pnpm --dir tauri/casepilot typecheck
pnpm --dir tauri/casepilot build
pnpm --dir tauri/casepilot --filter web exec playwright install chromium
pnpm --dir tauri/casepilot --filter web test:e2e
```

Run `npm test` for the legacy Electron suite. On headless Linux, run
`xvfb-run --auto-servernum npm test`. The CI fixture sets
`CASEPILOT_ELECTRON_TEST_NO_SANDBOX=1` for the offline Electron test processes
because Chromium's sandbox namespaces may be unavailable on hosted runners.

Playwright serves the built renderer, simulates the Tauri IPC responses and
fails on unexpected bridge calls, uncaught renderer errors and requests outside
the local test server. It covers navigation, settings persistence, inventory
account switching, sale confirmation, batch expiry and mobile keyboard navigation. Failed CI
runs publish traces and screenshots.

The macOS CI job runs Rust tests and launches the signed Apple Silicon package
against an isolated local fixture to check WKWebView, the Node sidecar and
native session isolation. Releases built by the workflow are ad-hoc signed.
Live authentication and game operations require a separate manual check.

## Source layout

- `tauri/casepilot/`: current React workspace, shared UI and native Rust shell.
- `tauri/runtime/`: Node operation engine and its tests.
- `tauri/scripts/`: desktop launcher and engine bundling tools.
- `tauri/shared/`: shared static definitions.
- `electron/`, `src/` and `tests/`: previous Electron implementation and tests.
- `qt/`: previous Qt implementation.
- `build/` and `public/`: application assets.

## Local configuration

Account credentials, cookies, browser sessions and optional server connection
settings are supplied locally by each user. No account store, server profile,
SSH key, environment file or personal connection settings are included here.
Local evidence, screenshots, dependency folders and compiled applications are
also excluded.

Only connect accounts and servers that you are authorized to use. The
application depends on an unofficial external interface that can change.
