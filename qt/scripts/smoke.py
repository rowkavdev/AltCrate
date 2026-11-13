"""Boot the real Qt/Node transport against an isolated, empty account store."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from PySide6.QtCore import QCoreApplication, QTimer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from casepilot.bridge import EngineBridge
from casepilot.security import EncryptedStore
from casepilot.network import NetworkBroker

app = QCoreApplication([])
directory = tempfile.TemporaryDirectory(prefix="casepilot-qt-smoke-")
key = os.urandom(32)
bridge = EngineBridge(ROOT, Path(directory.name), key)
network = NetworkBroker(bridge, EncryptedStore(Path(directory.name) / "sessions", key))
results = {"runtime": "Qt + Node; no Electron", "fixture": "isolated empty account store", "checks": []}
errors = []
local_state = {}
profile_config = {"farm": {"case": True, "money": False, "vault": True}, "targetCase": "a" * 24,
                  "itemRules": [{"id": "specific", "name": "AK-47 | Case Hardened", "action": "keep", "conditions": {"floatMin": .01, "floatMax": .1, "patterns": ["661"], "statTrak": False, "topN": 10}}], "destinations": []}


def created_group(value):
    local_state["group"] = next(group["id"] for group in value["groups"] if group["name"] == "Qt smoke group")
    local_state["order"] = [group["id"] for group in value["groups"]]
    return True


def saved_profile(value):
    profile = next(profile for profile in value["profiles"] if profile["name"] == "Qt smoke profile")
    local_state["profile"] = profile["id"]
    return profile["config"] == profile_config


def fail(message):
    errors.append(message)
    bridge.shutdown()


def native(message):
    try:
        network.handle(message)
    except Exception as error:
        bridge.reply_native(message["id"], error=str(error))


reads = [
    ("accounts:list", [], lambda value: value == []),
    ("workspace:read", [], lambda value: isinstance(value, dict)),
    ("preferences:read", [], lambda value: value == {"enableSiteOpening": False}),
    ("farm:status", [], lambda value: value["phase"] == "idle"),
    ("open:status", [], lambda value: value["phase"] == "idle"),
    ("converter:status", [], lambda value: value["phase"] == "idle"),
    ("accounts:login-status", [], lambda value: value["phase"] == "idle"),
    ("inventory-action:list", [], lambda value: value == []),
    ("inventory-batch:list", [], lambda value: value == []),
    ("storage-management:list", [], lambda value: value == []),
    ("progression-batch:list", [], lambda value: value == []),
    ("requests:metrics", [], lambda value: isinstance(value, dict)),
    ("extensions:capabilities", [], lambda value: isinstance(value, (dict, list))),
    ("local-ai:status", [], lambda value: value["phase"] == "missing"),
    ("blackjack:history", [], lambda value: isinstance(value, (dict, list))),
    ("history:query", [{}], lambda value: isinstance(value, (dict, list))),
    ("blackjack:qt-status", [], lambda value: value["rows"] == []),
    ("blackjack:research", [], lambda value: value["rows"] == [] and "simulation" in value),
    ("blackjack:self-check", [], lambda value: len(value) == 4 and all(row["passed"] for row in value)),
    ("workspace:command", ["createGroup", {"name": "Qt smoke group"}], created_group),
    ("workspace:command", lambda: ["updateGroup", {"id": local_state["group"], "name": "Qt renamed"}], lambda value: any(g["name"] == "Qt renamed" and g["id"] == local_state["group"] for g in value["groups"])),
    ("workspace:command", lambda: ["reorderGroups", {"groupIds": list(reversed(local_state["order"]))}], lambda value: [g["id"] for g in value["groups"]] == list(reversed(local_state["order"]))),
    ("workspace:command", lambda: ["deleteGroup", {"id": local_state["group"]}], lambda value: all(g["id"] != local_state["group"] for g in value["groups"])),
    ("workspace:command", ["saveProfile", {"name": "Qt smoke profile", "config": profile_config}], saved_profile),
    ("workspace:command", lambda: ["loadProfile", {"id": local_state["profile"]}], lambda value: value["config"] == profile_config),
    ("workspace:command", lambda: ["saveProfile", {"id": local_state["profile"], "name": "Qt renamed profile", "config": profile_config}], lambda value: any(p["id"] == local_state["profile"] and p["name"] == "Qt renamed profile" and p["config"] == profile_config for p in value["profiles"])),
    ("workspace:command", lambda: ["deleteProfile", {"id": local_state["profile"]}], lambda value: value["profiles"] == []),
    ("history:query", [{"accountId": "all", "kind": "skill-preset", "result": "confirmed", "from": "2026-10-01T00:00:00Z", "to": "2026-10-14T23:59:59.999Z", "offset": 100, "limit": 100}], lambda value: value["rows"] == [] and value["offset"] == 100 and value["limit"] == 100),
    ("farm:status", [], lambda value: value["phase"] == "idle"),
    ("open:status", [], lambda value: value["phase"] == "idle"),
    ("accounts:list", [], lambda value: value == []),
]


def run(index=0):
    if index == len(reads):
        bridge.invoke("accounts:refresh", ["unknown"],
                      lambda _: fail("Unknown account was accepted"),
                      lambda error: rejected(error))
        return
    channel, args, validate = reads[index]
    def done(value):
        if not validate(value):
            fail("Unexpected result from " + channel)
            return
        results["checks"].append(channel)
        run(index + 1)
    bridge.invoke(channel, args() if callable(args) else args, done, fail)


def rejected(error):
    if "Conta não encontrada" not in error:
        fail("Unexpected unknown-account error")
        return
    results["checks"].append("unknown account rejected")
    bridge.shutdown()


def ready(channels):
    expected = set(re.findall(r"invoke\('([^']+)'", (ROOT.parent / "electron/preload.cjs").read_text()))
    missing = sorted(expected - set(channels))
    results["channelCount"] = len(channels)
    results["legacyChannelCount"] = len(expected)
    if missing:
        fail("Missing commands: " + ", ".join(missing))
        return
    results["checks"].append("all existing desktop commands registered")
    run()


bridge.native_request.connect(native)
bridge.native_cancel.connect(network.cancel)
bridge.failed.connect(fail)
bridge.ready.connect(ready)
bridge.stopped.connect(app.quit)
QTimer.singleShot(20000, lambda: fail("Qt engine smoke test timed out"))
bridge.start()
app.exec()
results["passed"] = not errors
results["errors"] = errors
print(json.dumps(results, ensure_ascii=False, indent=2))
directory.cleanup()
sys.exit(1 if errors else 0)
