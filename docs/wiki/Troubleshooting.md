# Troubleshooting

## The app opens but the engine is unavailable

On Linux, unlock the desktop Secret Service provider and reopen AltCrate from the same logged-in desktop session. On macOS, check whether the Keychain access prompt needs attention. A build from source also needs the bundled Node sidecar. Build or reinstall the complete package if a sidecar or bundled resource is missing.

## An account needs sign-in again

Use the account’s sign-in action to reopen its browser session, complete the site’s verification, and then refresh the account. Keep cookies, passwords, and tokens inside the account flow. Exported or copied browser credentials should never be pasted into an issue.

## A request shows a cooldown or an uncertain result

- If the app shows a cooldown, wait for the displayed deadline before attempting more requests for the affected account or route.
- If an inventory or conversion operation shows **Unconfirmed**, open its result and choose **Verify state** when available. Check the source and destination before repeating an operation.
- If a batch review expires, prepare a fresh review for the remaining items after any uncertain results are resolved.
- If a remote worker is unreachable, inspect its configuration and observed state before moving execution to the desktop. Avoid running the same account on both hosts.

## Report a reproducible problem

Include the app version, operating system, affected workspace, steps to reproduce, and what you expected to see. Use synthetic or redacted data for screenshots and logs. Remove account identifiers, passwords, cookies, SSH details, and tokens from any public report.

[Issue forms](https://github.com/rowkavdev/AltCrate/issues/new/choose) · [Security policy](https://github.com/rowkavdev/AltCrate/blob/main/SECURITY.md)

[Back to the handbook](Home.md)
