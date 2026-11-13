# CasePilot Qt migration

Requested outcome: the complete CasePilot desktop application runs in Qt, with
all existing pages and operations, without Electron or a React/web application
as its desktop interface. This is an active migration, not a finished release.

The current checkout contains substantial uncommitted work. The Electron source
is preserved. `engine/` is a snapshot of the current operation services, with a
Qt transport and lifecycle replacing the Electron integration. The standalone
Qt distribution must contain only Qt, the Python application, and its bundled
Node operation engine. It must not require Electron, an external Node install,
or the previous installation to run.

## Acceptance requirements

- Native Qt pages: overview, accounts, automation, case opening, token converter,
  inventory and storage, games, rewards/missions/pass, skills and presets, optional
  site opening preferences, diagnostics, settings, and activity.
- Every existing desktop command has an equivalent Qt operation and reachable,
  task-specific controls. Exposing commands in a debug console is not parity.
- Account selection, groups, filters, operation profiles, pagination, item details,
  opening rules, ranking, bulk actions, recovery, and persistent history survive.
- Multi-account login uses isolated Qt browser profiles, with origin restrictions,
  cancellation, automatic login, and OS-protected credentials.
- HTTP and WebSocket sessions, cookies, proxies, timeouts, cancellation, cooldowns,
  coordination, and uncertain-mutation protections preserve existing contracts.
- The interface is responsive and provides loading, error, empty, active,
  confirmation, stopped, and recovery states. Preserve PT and EN support.
- Existing user data is preserved. Explicit migration must preserve IDs, rates,
  pending operations, and histories without starting saved automation.
- Farm server setup, trust, configuration, transfer, recovery, and restart work
  through native Qt dialogs and existing operation interlocks.
- Game controls, socket state, history, research, strategy and local AI are covered.
- Build a standalone macOS application, run it, and inspect all pages. Record a
  video and acceptance results. Fixture evidence must be labelled; live mutations
  require separate authorization.

## Current verified checkpoint

The Qt application now starts without Electron and exposes all 95 previous
desktop commands plus five native Blackjack control/research commands. All 13
pages instantiate as Qt widgets; the desktop interface contains no web renderer.
Qt WebEngine is used only for the site's login windows.

Implemented native pages include individual and batch inventory actions, storage
management, ranking, ordered opening rules, rewards/missions/pass, visual skill
maps, presets and progression batches, optional site opening settings, server
configuration and identity review, and independent controls for all nine games.
The existing unavailable game/extension actions remain unavailable.

Local operation profiles now save/load/edit/delete through native controls,
preserving ordered rules, attribute conditions and storage destinations. Loading
only populates the draft; it does not start operations or apply account modes.
Account groups support filtering, renaming, ordering and deletion while retaining
accounts. Account details follow observed snapshots. Persistent history supports
account/kind/result/date filters, bounded pagination, observed values and details,
with protection against stale responses. Claim-all repeats discovery to collect
newly unlocked rewards, deduplicates actions, caps each batch at 500, supports
stopping and halts after an uncertain result. Manual batches have an explicit
one-account/selected-accounts scope and checkboxes to choose individual actions.

Current evidence, generated against isolated or synthetic data:

- Native shadcn `bKsI1x32` appearance is implemented with Inter, Lucide, stone/red
  palettes, large radii, subtle menus, pointing-hand buttons and persistent
  light/dark/RTL preferences. All 13 pages use Qt styles and local assets. The
  RTL selection regression is covered through native table interaction tests.
  `evidence/shadcn-preview-dark/` and `evidence/shadcn-preview-light/` inspect the
  populated pages with labelled synthetic data; these are not live-game evidence.

- `evidence/engine-and-strategy-tests.log`: operation-engine and mathematical
  strategy regressions. Test fixtures are local; they are not live transfer proof.
- `evidence/real-engine-smoke.json`: actual Qt/Node process transport, complete
  registration of existing commands, safe reads, rejection of unknown accounts,
  and four calculations through background Node workers.
- `evidence/all-native-tests.log`: network, callback and interaction tests, including stale account
  responses, pagination/selection, native confirmation, ordered opening rules,
  valid config serialization, and Blackjack turn/funding/stop controls. The
  service responses in these UI tests are synthetic.
- `evidence/claim-all-tests.log`: seven Qt callback checks for unlocks, batching,
  failed discovery, uncertain results, and cancellation at all three stages.
  `real-engine-smoke.json` also exercises profile and group persistence through
  the actual Qt/Node transport in a temporary, empty account store.
- `tests/test_native.py`: eight real Qt network tests against a local HTTP fixture,
  covering cookies, isolation, encryption, tampering, redirects and cancellation.
- `evidence/native-preview/`: screenshots and a labelled fixture walkthrough
  video. This is an offscreen Qt preview, not production/account/device proof.

The React rendering cases in the copied local-AI/activity suites are replaced by
native UI checks rather than bringing React into the Qt runtime. Independent
strategy tests execute the same copied mathematics in `strategy/`.

## Required work remaining

- Complete the source-to-Qt parity audit and verify the remaining controls and
  user flows; the implemented profiles/groups/history/claim-all flows have native
  interaction and isolated transport evidence but have not used live accounts.
- Complete and verify account login with a distinct proxy per account. The current
  host explicitly rejects proxied login rather than silently using another route.
  Isolated Qt login helper processes are the intended next step because Chromium
  inside one Qt process does not provide per-profile application proxy settings.
- Implement an explicit, safe data migration preserving original data, IDs,
  quotas, pending operations and history. Do not activate a saved farm or resolve
  a saved remote transition automatically during import. Legacy encrypted
  credentials/cookies need a deliberate conversion or reauthentication path.
- Audit automatic Blackjack stop/start races, disconnects, partial failures,
  background worker failure/recovery, history detail, and visible research states.
- Verify live/native login behavior with permission-neutral read-only checks,
  WebSocket text/binary transport and per-session cookies/proxies. Do not run live
  farm, conversion, transfers, bets or server installation as migration tests.
- Finish English translations and responsive layouts, inspect populated native
  pages and interactive controls, and validate screenshots at supported widths.
- Package and run a standalone macOS app with bundled Node. It must have no
  Electron/React dependency or requirement for the old checkout, external Node,
  virtualenv or local Python install. Inspect and verify the packaged artifact.
- Make the complete Qt build the normal application path only after parity and
  distribution pass; preserve the original dirty checkout and legacy artifacts.

The objective is still active. The existing evidence does not prove completion.
