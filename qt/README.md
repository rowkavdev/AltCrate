# CasePilot Qt

Active migration of the entire CasePilot desktop application to native Qt 6.
The interface uses PySide6 widgets. The operation engine runs as a private bundled
Node process and reuses the existing coordination and reconciliation safeguards.
There is no Electron or React dependency in this application's runtime.

This directory is not yet a finished standalone release. See `MIGRATION.md` for
the complete scope, verified evidence, and remaining work.

## Native appearance

The `bKsI1x32` shadcn preset is applied to native Qt controls: Luma layout,
stone palette, red primary actions, large radii, Inter and Lucide navigation.
Fonts and SVG icons are local assets with their licenses; React, Next.js and
Tailwind are not loaded by Qt. `Settings → Appearance` switches light/dark and
RTL; RTL starts enabled as requested. Buttons use the pointing-hand cursor.
These preferences persist locally and do not change selected accounts or invoke
the operation engine. `scripts/import_preset.py` reproduces the bundled palette,
font and icons from the existing local preset packages (build tooling only).

## Development

From the repository root, after creating the isolated `qt/.venv` and installing
`qt/requirements.txt` plus the engine's npm dependencies:

```sh
qt/.venv/bin/python qt/run.py
```

The Qt application has its own data directory and does not overwrite the previous
application's accounts or sessions. Passwords and session cookies use an
OS-protected vault; development/preview fixtures use an ephemeral key.

## Isolated verification

```sh
npm --prefix qt test
qt/.venv/bin/python qt/scripts/smoke.py
QT_QPA_PLATFORM=offscreen qt/.venv/bin/python -m unittest discover -s qt/tests -p test_native.py -v
QT_QPA_PLATFORM=offscreen qt/.venv/bin/python -m unittest discover -s qt/tests -p test_ui.py -v
QT_QPA_PLATFORM=offscreen qt/.venv/bin/python qt/run.py --fixture --verify-ui qt/evidence/empty-states
QT_QPA_PLATFORM=offscreen qt/.venv/bin/python qt/scripts/preview_native.py
```

The first three checks exercise the actual operation services/Qt transport against
empty or local fixture data. UI tests and populated previews use synthetic service
responses and do not send game requests. Passing them does not establish live
account login, transfers, bets, farm behavior, or remote server installation.
