# Getting started

## Ubuntu 24.04 x86-64

1. Download the `AltCrate_*_amd64.deb` file and `SHA256SUMS-linux-amd64.txt` from the same [GitHub release](https://github.com/rowkavdev/AltCrate/releases).
2. In the download folder, verify the checksum and install the exact filename you downloaded. For version 0.4.1:

   ```sh
   sha256sum -c SHA256SUMS-linux-amd64.txt
   sudo apt install ./AltCrate_0.4.1_amd64.deb
   ```

3. Open **AltCrate** from your desktop menu or run `altcrate`. The desktop session needs an unlocked Secret Service provider, such as GNOME Keyring or KeePassXC with Secret Service enabled.

The AltCrate package replaces the older CasePilot package. Both versions use the same local data and credential-store identifiers. CI checks package installation and launch with an empty profile. Live Linux sign-in is still tracked for manual verification.

## Apple Silicon macOS

Use an arm64 Node.js 24 installation, the pnpm version in the desktop workspace manifest, Rust, and the Xcode command-line tools. Run these commands from the repository root:

```sh
npm ci
npm exec -- install-electron
pnpm --dir tauri/runtime install --frozen-lockfile
pnpm --dir tauri/casepilot install --frozen-lockfile
npm run package:mac
npm start
```

The build produces an ad-hoc-signed `release-tauri/mac-arm64/AltCrate.app`. macOS 14 or later is required. The first launch may need access to the system Keychain.

## Connect your first account

1. Open **Accounts** and choose **Add account**.
2. Sign in to the game in the account window. Complete any verification the site requests there.
3. Return to **Overview** and refresh. Check that the account and its observed balances appear before configuring any operations.
4. Open **Inventory** or **Rewards** to inspect account data. Keep the first operation scoped to one account while you check its review and result screens.

Use **Settings** to change the interface language. See [Troubleshooting](Troubleshooting.md) if the engine, sign-in window, or account refresh fails.

[Back to the handbook](Home.md)
