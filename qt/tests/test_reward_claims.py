"""Qt callback flow for complete claiming, with no game or network access."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication
from casepilot.model import WorkspaceModel
from casepilot.reward_claims import ClaimAllRunner
from ui_fixture import FixtureBridge

app = QCoreApplication.instance() or QCoreApplication([])


def pump():
    for _ in range(30):
        app.processEvents()


def reward(identifier):
    return {"accountId": "alpha", "kind": "reward", "payload": {"id": identifier}, "eligible": True}


class ClaimTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FixtureBridge()
        self.model = WorkspaceModel(self.bridge)
        self.model.available = True
        self.prepared = []
        self.confirmed = []
        self.scans = 0
        self.results = []
        self.errors = []
        self.runner = ClaimAllRunner(self.model, ["alpha"])
        self.runner.finished.connect(self.results.append)
        self.runner.failed.connect(self.errors.append)
        def prepare(args):
            actions = args[0]["actions"]
            self.prepared.append(actions)
            return {"batchId": str(len(self.prepared)), "phase": "review", "rows": [{"state": "ready"} for _ in actions]}
        def confirm(args):
            self.confirmed.append(args[0])
            return {"batchId": args[0], "phase": "completed", "rows": [{"state": "confirmed"} for _ in self.prepared[int(args[0])-1]]}
        def scan(args):
            self.assertEqual(args[0], {"accountIds": ["alpha"], "kinds": ["reward", "mission", "pass"]})
            self.scans += 1
            return self.rows(self.scans)
        self.rows = lambda _: []
        self.bridge.responses.update({"progression-batch:discover": scan, "progression-batch:prepare": prepare, "progression-batch:confirm": confirm,
                                      "progression-batch:stop": lambda args: {"batchId": args[0], "phase": "stopped", "rows": [{"state": "cancelled"}]}})

    def tearDown(self):
        self.model.deleteLater()
        self.bridge.deleteLater()
        pump()

    def test_newly_unlocked_rewards_are_collected_without_duplicates(self):
        first = [reward(1.25), {"accountId": "alpha", "kind": "mission", "payload": {"id": "day"}, "eligible": True}, {"accountId": "alpha", "kind": "pass", "payload": {"tier": 1, "track": "premium"}, "eligible": True}]
        self.rows = lambda scan: first if scan == 1 else [first[0], reward(2.25)] if scan == 2 else []
        self.assertTrue(self.runner.start())
        pump()
        self.assertEqual(self.results[0]["confirmed"], 4)
        self.assertEqual([len(batch) for batch in self.prepared], [3, 1])
        self.assertEqual(self.scans, 3)
        self.assertFalse(self.model.claim_busy)
        self.assertEqual(self.errors, [])

    def test_large_claim_uses_multiple_bounded_batches(self):
        self.rows = lambda _: [reward(index) for index in range(501)]
        self.runner.start()
        pump()
        self.assertEqual([len(batch) for batch in self.prepared], [500, 1])
        self.assertEqual(self.results[0]["confirmed"], 501)
        self.assertEqual(self.scans, 3)

    def test_failed_discovery_sends_nothing_and_reports_the_error(self):
        self.rows = lambda _: [reward(1), {"state": "failed", "message": "Consulta indisponível"}]
        self.runner.start()
        pump()
        self.assertEqual(self.errors, ["Consulta indisponível"])
        self.assertEqual(self.prepared, [])
        self.assertEqual(self.confirmed, [])

    def test_unconfirmed_result_never_rescans_or_retries(self):
        self.rows = lambda _: [reward(1)]
        self.bridge.responses["progression-batch:confirm"] = {"batchId": "1", "phase": "blocked", "rows": [{"state": "unconfirmed"}]}
        self.runner.start()
        pump()
        self.assertEqual(self.scans, 1)
        self.assertEqual(self.results[0]["confirmed"], 0)
        self.assertEqual(self.results[0]["batch"]["phase"], "blocked")

    def test_stop_during_discovery_sends_no_preparation(self):
        self.bridge.deferred.add("progression-batch:discover")
        self.runner.start()
        self.runner.stop()
        self.bridge.held[0][2]([reward(1)])
        pump()
        self.assertEqual(self.prepared, [])
        self.assertTrue(self.results[0]["stopped"])

    def test_stop_during_preparation_cancels_without_confirming(self):
        self.rows = lambda _: [reward(1)]
        self.bridge.deferred.add("progression-batch:prepare")
        self.runner.start()
        pump()
        self.runner.stop()
        request = self.bridge.held[-1]
        request[2]({"batchId": "1", "phase": "review", "rows": [{"state": "ready"}]})
        pump()
        self.assertEqual(self.confirmed, [])
        self.assertIn(("progression-batch:stop", ["1"]), self.bridge.calls)
        self.assertTrue(self.results[0]["stopped"])

    def test_stop_during_confirmation_is_sent_once_and_no_next_scan(self):
        self.rows = lambda _: [reward(1)]
        self.bridge.deferred.add("progression-batch:confirm")
        self.runner.start()
        pump()
        self.runner.stop()
        self.runner.stop()
        self.assertEqual(sum(channel == "progression-batch:stop" for channel, _ in self.bridge.calls), 1)
        self.bridge.held[-1][2]({"batchId": "1", "phase": "stopped", "rows": [{"state": "cancelled"}]})
        pump()
        self.assertEqual(self.scans, 1)
        self.assertTrue(self.results[0]["stopped"])
