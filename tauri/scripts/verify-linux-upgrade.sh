#!/usr/bin/env bash
set -euo pipefail

report_dir="${1:?Supply an absolute path for the upgrade reports}"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$report_dir/previous" "$report_dir/current"

previous_package="$scratch/CasePilot_0.4.0_amd64.deb"
curl --fail --silent --show-error --location --retry 3 \
  --output "$previous_package" \
  https://github.com/rowkavdev/AltCrate/releases/download/v0.4.0-linux.1/CasePilot_0.4.0_amd64.deb
printf '%s  %s\n' c75fba580595e6b3e6fed3a550e22c457b027b492d6109ffcde8fb47cb441425 "$previous_package" |
  sha256sum --check --strict
test "$(dpkg-deb -f "$previous_package" Package)" = case-pilot
test "$(dpkg-deb -f "$previous_package" Version)" = 0.4.0
test "$(dpkg-deb -f "$previous_package" Architecture)" = amd64

# Start from the published package even when the fresh-install smoke test ran first.
if [ "$(dpkg-query -W -f='${Status}' alt-crate 2>/dev/null || true)" = 'install ok installed' ]; then
  sudo apt-get remove -y alt-crate
fi
sudo apt-get install -y --no-install-recommends "$previous_package"
test "$(dpkg-query -W -f='${Status}' case-pilot)" = 'install ok installed'
test ! -e /usr/bin/altcrate

export XDG_DATA_HOME="$scratch/user-data"
export XDG_CONFIG_HOME="$scratch/user-config"
export XDG_CACHE_HOME="$scratch/user-cache"
export TMPDIR="$scratch/fixture"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

run_fixture() {
  local executable="$1" output="$2"
  CASEPILOT_VERIFY_UI="$output" timeout 120s dbus-run-session -- xvfb-run --auto-servernum "$executable" \
    >"$output/launch.log" 2>&1 || {
      cat "$output/launch.log"
      return 1
    }
  jq -e '.passed == true and .liveGameRequests == 0' "$output/native-report.json"
}

# CasePilot's fixture saves the preference in its temporary engine directory.
# Put that file under CasePilot's production bundle identifier in the isolated XDG profile.
run_fixture /usr/bin/casepilot-desktop "$report_dir/previous"
shopt -s nullglob
saved=("$TMPDIR"/casepilot-tauri-fixture-*/app-preferences.json)
test "${#saved[@]}" -eq 1
jq -e '.enableSiteOpening == true' "${saved[0]}"
profile="$XDG_DATA_HOME/pt.casepilot.desktop"
mkdir -p "$profile"
install -m 600 "${saved[0]}" "$profile/app-preferences.json"

package_dir=tauri/casepilot/src-tauri/target/release/bundle/deb
packages=("$PWD/$package_dir"/*.deb)
test "${#packages[@]}" -eq 1
sudo apt-get install -y --no-install-recommends "${packages[0]}"
test "$(dpkg-query -W -f='${Status}' alt-crate)" = 'install ok installed'
if dpkg-query -W -f='${Status}' case-pilot 2>/dev/null | grep -q ' ok installed$'; then
  echo 'CasePilot is still installed after upgrading to AltCrate.' >&2
  exit 1
fi
test ! -e /usr/bin/casepilot-desktop
dpkg-query -S /usr/bin/casepilot-node | grep -Fx 'alt-crate: /usr/bin/casepilot-node'
cmp "${saved[0]}" "$profile/app-preferences.json"

export CASEPILOT_VERIFY_LINUX_UPGRADE=1
run_fixture /usr/bin/altcrate "$report_dir/current"
jq -e '.linuxUpgradeDataRetained == true and .englishWorkspace == true and (.pages | length == 13)' \
  "$report_dir/current/native-report.json"
cmp "${saved[0]}" "$profile/app-preferences.json"
