# AltCrate

Source code for the CasePilot desktop application. The current interface uses
Tauri 2, React, Vite and Radix UI; the operation engine runs in Node.js.
The earlier Electron and Qt implementations are retained in this repository.

## Requirements

- Node.js 20.19 or later and npm.
- pnpm, using the version declared in `tauri/casepilot/package.json`.
- Rust and the native build tools required by Tauri. macOS builds also require
  the Apple command line developer tools.

## Install and run

```sh
npm install
pnpm --dir tauri/runtime install
pnpm --dir tauri/casepilot install
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

```sh
npm test
node --test tauri/runtime/tests/*.test.cjs
pnpm --dir tauri/casepilot typecheck
pnpm --dir tauri/casepilot build
```

These checks use synthetic fixtures and local transports. They do not establish
that authentication or operations against an external service will succeed.

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
