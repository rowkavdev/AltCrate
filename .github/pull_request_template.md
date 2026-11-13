## Summary

<!-- What does this PR change and why? -->

## Checklist

Run the same checks as [CI](.github/workflows/ci.yml) before requesting review:

- [ ] `npm ci` (repo root)
- [ ] `npm test` (legacy root `node:test` suite — no live game or auth)
- [ ] `pnpm install --frozen-lockfile` in `tauri/runtime`
- [ ] `npm run test:tauri` (engine bundle, smoke, `tauri/runtime` tests)
- [ ] `pnpm install --frozen-lockfile` in `tauri/casepilot`
- [ ] `pnpm lint` in `tauri/casepilot`
- [ ] `pnpm typecheck` in `tauri/casepilot`
- [ ] `pnpm build` in `tauri/casepilot` (Vite web build only)

## Legacy trees

If this PR touches **`electron/`** or **`qt/`**, note what was validated (these paths are not covered by default CI jobs):

- [ ] N/A — no legacy tree changes
- [ ] `electron/` — manual checks: <!-- describe -->
- [ ] `qt/` — manual checks: <!-- describe -->

## Credentials

- [ ] No cookies, session tokens, passwords, or account exports in the diff, issue links, or CI artifacts
