"""Collect unlocked rewards through the existing reviewed/verified batch engine."""
import json
from uuid import uuid4
from PySide6.QtCore import QObject, Signal


class ClaimAllRunner(QObject):
    batch_changed = Signal(dict)
    finished = Signal(dict)
    failed = Signal(str)

    def __init__(self, model, identifiers):
        super().__init__(model)
        self.model = model
        self.identifiers = list(identifiers)
        self.token = str(uuid4())
        self.seen = set()
        self.confirmed = 0
        self.batch = None
        self.stage = "idle"
        self.cancelled = False
        self.terminal = False
        self.stop_sent = set()

    def start(self):
        if self.model.claim_busy or not self.identifiers or self.stage != "idle":
            return False
        self.model.claim_busy = True
        self.model.claim_runner = self
        self.model.changed.emit()
        self.discover()
        return True

    def call(self, action, args, done):
        self.model.call("progression-batch:" + action, args, done,
                        busy_key="claim:" + self.token + ":" + action, error=self.fail)

    def publish(self, batch):
        self.batch = batch
        self.batch_changed.emit(batch)

    def discover(self):
        if self.cancelled:
            self.finish()
            return
        self.stage = "discover"
        self.call("discover", [{"accountIds": self.identifiers, "kinds": ["reward", "mission", "pass"]}], self.discovered)

    def discovered(self, rows):
        if self.cancelled:
            self.finish()
            return
        failure = next((row for row in rows if row.get("state") == "failed"), None)
        if failure:
            self.fail(failure.get("message") or "Não foi possível consultar todas as recompensas.")
            return
        actions = []
        for row in rows:
            if row.get("eligible") is True and row.get("kind") in ("reward", "mission", "pass"):
                action = {key: row[key] for key in ("accountId", "kind", "payload")}
                key = json.dumps(action, sort_keys=True, separators=(",", ":"))
                if key not in self.seen:
                    self.seen.add(key)
                    actions.append(action)
                    if len(actions) == 500:
                        break
        if not actions:
            self.finish()
            return
        self.stage = "prepare"
        self.call("prepare", [{"actions": actions}], self.prepared)

    def prepared(self, batch):
        self.publish(batch)
        if self.cancelled:
            self.stage = "stop"
            self.call("stop", [batch["batchId"]], lambda value: (self.publish(value), self.finish()))
            return
        if not any(row.get("state") == "ready" for row in batch["rows"]):
            self.finish()
            return
        self.stage = "confirm"
        self.call("confirm", [batch["batchId"]], self.confirmed_batch)

    def confirmed_batch(self, batch):
        self.publish(batch)
        self.confirmed += sum(row.get("state") == "confirmed" for row in batch["rows"])
        if self.cancelled or batch.get("phase") != "completed" or any(row.get("state") != "confirmed" for row in batch["rows"]):
            self.finish()
        else:
            self.discover()

    def stop(self, *_):
        if self.terminal:
            return
        self.cancelled = True
        if self.stage == "confirm" and self.batch:
            identifier = self.batch["batchId"]
            if identifier not in self.stop_sent:
                self.stop_sent.add(identifier)
                self.call("stop", [identifier], self.publish)

    def finish(self):
        if self.terminal:
            return
        self.terminal = True
        self.stage = "finished"
        self.model.claim_busy = False
        if self.model.claim_runner is self:
            self.model.claim_runner = None
        self.model.changed.emit()
        self.finished.emit({"confirmed": self.confirmed, "batch": self.batch, "stopped": self.cancelled})

    def fail(self, message):
        self.finish()
        self.failed.emit(str(message))
