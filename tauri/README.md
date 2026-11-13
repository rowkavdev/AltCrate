# CasePilot Tauri

The active desktop application uses Tauri 2, React, Vite and Radix UI.
The frontend and native Rust shell are in `casepilot/`. The Node engine is
in `runtime/`, and shared static definitions are in `shared/`.

See the repository README for installation, development and offline checks.
The desktop launcher and engine bundling helpers are in `scripts/`.

Account credentials, browser sessions and optional server connection profiles
are created locally. They are not part of this source distribution.
