"""Desktop state and bounded background refresh for native Qt pages."""
from __future__ import annotations
from collections import deque
from PySide6.QtCore import QObject, QTimer, Signal, QSettings


class WorkspaceModel(QObject):
    changed = Signal()
    notice = Signal(str)
    operation_result = Signal(str, object)
    profile_loaded = Signal(dict)
    config_changed = Signal()

    def __init__(self, bridge, parent=None):
        super().__init__(parent)
        self.bridge = bridge
        self.accounts = []
        self.snapshots = {}
        self.selected = set()
        self.workspace = {"groups": [], "accountGroups": {}, "profiles": []}
        self.farm = {"phase": "idle", "accounts": []}
        self.opening = {"phase": "idle", "opened": 0}
        self.converter = {"phase": "idle", "rows": []}
        self.login = {"phase": "idle"}
        self.preferences = {"enableSiteOpening": False}
        self.events = []
        self.capabilities = []
        self.inventory_operations = []
        self.available = False
        self.loaded_profile = None
        self.claim_busy = False
        self.claim_runner = None
        self.profile_config = lambda: {"farm": {"case": True, "money": True, "vault": True}, "targetCase": None, "itemRules": [], "destinations": []}
        self.pending = set()
        self.refresh_queue = deque()
        self.refresh_active = set()
        self.refresh_versions = {}
        self.settings = QSettings()
        bridge.ready.connect(self._ready)
        bridge.failed.connect(self.notice.emit)
        bridge.event.connect(self._event)
        self.poll_timer = QTimer(self)
        self.poll_timer.setInterval(2000)
        self.poll_timer.timeout.connect(self.poll)

    def call(self, channel, args=None, done=None, *, busy_key=None, error=None):
        key = busy_key or channel
        if key in self.pending:
            return
        self.pending.add(key)
        self.changed.emit()
        def success(value):
            self.pending.discard(key)
            if done:
                done(value)
            self.operation_result.emit(channel, value)
            self.changed.emit()
        def failure(message):
            self.pending.discard(key)
            (error or self.notice.emit)(message)
            self.changed.emit()
        self.bridge.invoke(channel, args or [], success, failure)

    def _ready(self, channels):
        self.available = True
        self.reload_accounts()
        for channel, field in (("workspace:read", "workspace"), ("preferences:read", "preferences"),
                               ("extensions:capabilities", "capabilities"), ("inventory-action:list", "inventory_operations")):
            self.call(channel, done=lambda value, field=field: setattr(self, field, value))
        self.poll()
        self.poll_timer.start()

    def reload_accounts(self):
        def loaded(accounts):
            self.accounts = accounts
            self.selected &= {account["id"] for account in accounts}
            self.refresh_accounts()
        self.call("accounts:list", done=loaded)

    def select(self, identifiers):
        known = {account["id"] for account in self.accounts}
        self.selected = set(identifiers) & known
        self.changed.emit()

    def selected_ids(self):
        return [account["id"] for account in self.accounts if account["id"] in self.selected]

    def poll(self):
        if not self.available:
            return
        for channel, field in (("farm:status", "farm"), ("open:status", "opening"),
                               ("converter:status", "converter"), ("accounts:login-status", "login")):
            self.call(channel, done=lambda value, field=field: setattr(self, field, value))

    def refresh_accounts(self, identifiers=None):
        if self.farm.get("budget", {}).get("cooldownUntil", 0) > __import__("time").time() * 1000:
            self.notice.emit("Aguarda o fim da pausa indicada pelo servidor antes de atualizar.")
            return
        ids = identifiers if identifiers is not None else [account["id"] for account in self.accounts]
        for identifier in ids:
            if identifier not in self.refresh_queue and identifier not in self.refresh_active:
                self.refresh_queue.append(identifier)
        self._drain_refresh()

    def _drain_refresh(self):
        while self.refresh_queue and len(self.refresh_active) < 4:
            identifier = self.refresh_queue.popleft()
            self.refresh_active.add(identifier)
            version = self.refresh_versions.get(identifier, 0) + 1
            self.refresh_versions[identifier] = version
            def done(value, identifier=identifier, version=version):
                self.refresh_active.discard(identifier)
                if self.refresh_versions.get(identifier) == version:
                    self.snapshots[identifier] = value
                self.changed.emit()
                self._drain_refresh()
            def failed(message, identifier=identifier, version=version):
                done({"error": message}, identifier, version)
            self.call("accounts:refresh", [identifier], done, busy_key="refresh:" + identifier, error=failed)

    def totals(self):
        result = {"connected": 0, "money": 0, "tokens": 0, "cases": 0}
        for account in self.accounts:
            snapshot = self.snapshots.get(account["id"], {})
            if snapshot and not snapshot.get("error"):
                result["connected"] += 1
                for key, source in (("money", "money"), ("tokens", "tokens"), ("cases", "casesTotal")):
                    value = snapshot.get(source)
                    if isinstance(value, (int, float)):
                        result[key] += value
        return result

    def workspace_command(self, action, payload, done=None):
        def updated(value):
            if isinstance(value, dict) and "groups" in value:
                self.workspace = value
            if done:
                done(value)
        self.call("workspace:command", [action, payload], updated)

    def apply_profile(self, config):
        from copy import deepcopy
        self.loaded_profile = deepcopy(config)
        self.profile_loaded.emit(deepcopy(config))
        self.config_changed.emit()
        self.notice.emit("Configuração carregada. Revê as contas antes de iniciar a operação.")

    def _event(self, event):
        kind = event.get("type")
        self.events.insert(0, event)
        self.events = self.events[:500]
        if kind in ("notice", "run-error"):
            self.notice.emit(event.get("message", ""))
        if kind == "token-converter" and event.get("status"):
            self.converter = event["status"]
        elif kind == "account-login-progress" and event.get("status"):
            self.login = event["status"]
        elif isinstance(event.get("status"), dict):
            status = event["status"]
            if "opened" in status:
                self.opening = status
            elif "accounts" in status:
                self.farm = status
        if kind in ("account-added", "account-removed"):
            self.reload_accounts()
        identifier = event.get("accountId")
        if identifier and isinstance(event.get("snapshot"), dict):
            self.refresh_versions[identifier] = self.refresh_versions.get(identifier, 0) + 1
            self.snapshots[identifier] = event["snapshot"]
        if kind in ("farm-started", "cooldown"):
            self.refresh_queue.clear()
        if self.farm.get("execution", {}).get("kind") == "server":
            self.snapshots.update(self.farm.get("observations", {}))
        self.changed.emit()
