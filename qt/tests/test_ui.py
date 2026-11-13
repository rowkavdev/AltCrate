import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from copy import deepcopy
from pathlib import Path
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PySide6.QtCore import QSettings, QTimer, Qt
from PySide6.QtWidgets import QApplication, QDialog, QLabel, QPushButton
from PySide6.QtTest import QTest
from PySide6.QtGui import QPalette
from casepilot.model import WorkspaceModel
from casepilot.window import MainWindow, PAGE_FACTORIES
from casepilot.widgets import STYLE, AccountSelection
from casepilot.theme import apply_appearance
from casepilot.pages.opening_rules import RuleDialog
from ui_fixture import FixtureBridge, ACCOUNTS, CASE_ID, ITEM_ID

app = QApplication.instance() or QApplication([])
app.setOrganizationName("CasePilotQtTests")
app.setApplicationName("CasePilotQtTests")
app.setStyleSheet(STYLE)


def pump():
    for _ in range(12):
        app.processEvents()


class UiTests(unittest.TestCase):
    def setUp(self):
        self.qt_errors = []
        self.previous_hook = sys.excepthook
        sys.excepthook = lambda kind, value, traceback: self.qt_errors.append(str(value))
        self.directory = tempfile.TemporaryDirectory()
        QSettings.setDefaultFormat(QSettings.IniFormat)
        QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, self.directory.name)
        QSettings().clear()
        apply_appearance()
        self.bridge = FixtureBridge()
        self.model = WorkspaceModel(self.bridge)
        self.model.fixture = True
        self.model.available = True
        self.model.accounts = ACCOUNTS.copy()
        self.model.preferences = {"enableSiteOpening": True}
        self.model.snapshots = {account["id"]: self.bridge.response("accounts:refresh", [account["id"]]) for account in ACCOUNTS}
        self.window = MainWindow(self.model, fixture=True)
        self.window.show()
        self.model.changed.emit()
        pump()

    def tearDown(self):
        self.window.allow_close = True
        self.window.close()
        self.window.deleteLater()
        pump()
        self.directory.cleanup()
        sys.excepthook = self.previous_hook
        self.assertEqual(self.qt_errors, [], "Qt callback errors")

    def select_account(self, page, identifier="alpha"):
        page.account.setCurrentIndex(page.account.findData(identifier))
        pump()

    def confirm_review(self, action):
        timer = QTimer()
        def confirm():
            dialog = QApplication.activeModalWidget()
            if isinstance(dialog, QDialog):
                for control in dialog.findChildren(QPushButton):
                    if control.property("primary"):
                        QTest.mouseClick(control, Qt.LeftButton)
                        timer.stop()
                        return
        timer.timeout.connect(confirm)
        timer.start(10)
        action()
        timer.stop()
        pump()

    def workspace_fixture(self, profiles=None):
        state = {"version": 1, "groups": [{"id": "main", "name": "Principal"}, {"id": "store", "name": "Storage"}], "accountGroups": {"alpha": "main", "beta": "store"}, "profiles": deepcopy(profiles or [])}
        def command(args):
            action, payload = args
            if action == "loadProfile":
                return deepcopy(next(p for p in state["profiles"] if p["id"] == payload["id"]))
            if action == "saveProfile":
                identifier = payload.get("id", "fixture-profile")
                state["profiles"] = [p for p in state["profiles"] if p["id"] != identifier] + [{"id": identifier, "name": payload["name"], "config": deepcopy(payload["config"])}]
            elif action == "deleteProfile":
                state["profiles"] = [p for p in state["profiles"] if p["id"] != payload["id"]]
            elif action == "updateGroup":
                next(g for g in state["groups"] if g["id"] == payload["id"])["name"] = payload["name"]
            elif action == "reorderGroups":
                state["groups"] = [next(g for g in state["groups"] if g["id"] == identifier) for identifier in payload["groupIds"]]
            elif action == "deleteGroup":
                state["groups"] = [g for g in state["groups"] if g["id"] != payload["id"]]
                state["accountGroups"] = {a: g for a, g in state["accountGroups"].items() if g != payload["id"]}
            return deepcopy(state)
        self.bridge.responses["workspace:command"] = command
        self.model.workspace = deepcopy(state)
        self.model.changed.emit()
        pump()
        return state

    def test_profile_roundtrip_preserves_rules_destinations_and_never_runs(self):
        config = {"farm": {"case": True, "money": False, "vault": False}, "targetCase": CASE_ID,
                  "itemRules": [{"id": "stored", "name": "AK-47 | Case Hardened", "action": "storage", "conditions": {"floatMin": .01, "floatMax": .1, "statTrak": False, "patterns": ["661"], "topN": 10}, "destinationAccountId": "beta", "storageUnitId": "c" * 24}], "destinations": [{"accountId": "beta", "storageUnitId": "c" * 24}]}
        state = self.workspace_fixture([{"id": "saved", "name": "Guardado", "config": config}])
        self.model.select({"alpha"})
        self.window.navigate("accounts")
        panel = self.window.page_widgets["accounts"].profiles
        panel.table.selectRow(0)
        panel.load_button.click()
        pump()
        opening = self.window.page_widgets["opening"]
        self.assertEqual(opening.cases.currentData(), CASE_ID)
        self.assertEqual(opening.rules.current_rules(), config["itemRules"])
        self.assertEqual(self.model.profile_config(), config)
        self.assertFalse(opening.convert.isChecked())
        self.assertEqual(self.model.selected, {"alpha"})
        panel.name.setText("Cópia")
        panel.save_button.click()
        pump()
        self.assertEqual(state["profiles"][-1]["config"], config)
        panel.table.selectRow(0)
        panel.edit_button.click()
        panel.name.setText("Novo nome")
        panel.modes["money"].setChecked(True)
        panel.save_button.click()
        pump()
        edited = next(p for p in state["profiles"] if p["id"] == "saved")
        self.assertEqual(edited["name"], "Novo nome")
        self.assertEqual(edited["config"]["itemRules"], config["itemRules"])
        self.assertEqual(edited["config"]["destinations"], config["destinations"])
        self.assertTrue(edited["config"]["farm"]["money"])
        panel.table.selectRow(next(i for i, p in enumerate(panel.table.records) if p["id"] == "saved"))
        self.confirm_review(panel.delete)
        self.assertFalse(any(p["id"] == "saved" for p in state["profiles"]))
        self.assertFalse(any(channel in ("farm:start", "farm:modes", "open:start", "converter:start") for channel, _ in self.bridge.calls))

    def test_profile_draft_survives_background_snapshot_updates(self):
        panel = self.window.page_widgets["accounts"].profiles
        panel.case.setCurrentIndex(panel.case.findData(CASE_ID))
        panel.modes["money"].setChecked(False)
        other_case = {"id": "d" * 24, "name": "Nova caixa", "amount": 1}
        self.model.snapshots["alpha"]["cases"].append(other_case)
        self.model.changed.emit()
        pump()
        self.assertEqual(panel.case.currentData(), CASE_ID)
        self.assertFalse(panel.modes["money"].isChecked())

    def test_groups_filter_rename_order_delete_and_preserve_accounts(self):
        state = self.workspace_fixture()
        page = self.window.page_widgets["accounts"]
        page.group_filter.setCurrentIndex(page.group_filter.findData("main"))
        pump()
        self.assertEqual([r["id"] for r in page.table.records], ["alpha"])
        page.groups.selectRow(0)
        from PySide6.QtWidgets import QInputDialog
        with patch.object(QInputDialog, "getText", return_value=("Novo grupo", True)):
            page.rename_group()
        pump()
        self.assertEqual(state["groups"][0]["name"], "Novo grupo")
        page.groups.selectRow(0)
        page.move_group(1)
        pump()
        self.assertEqual([g["id"] for g in state["groups"]], ["store", "main"])
        page.groups.selectRow(1)
        self.confirm_review(page.delete_group)
        self.assertNotIn("alpha", state["accountGroups"])
        self.assertEqual([a["id"] for a in self.model.accounts], ["alpha", "beta"])
        self.assertEqual(page.group_filter.currentData(), "all")
        self.assertFalse(any(c == "accounts:remove" for c, _ in self.bridge.calls))

    def test_account_details_follow_snapshots_and_clear_removed_table_selection(self):
        page = self.window.page_widgets["accounts"]
        page.table.selectRow(0)
        dialog = page.details()
        self.assertEqual(dialog.fields["id"].text(), "alpha")
        self.assertEqual(dialog.cases.rowCount(), 1)
        self.model.snapshots["alpha"]["tokens"] = 321
        self.model.changed.emit()
        pump()
        self.assertIn("321", dialog.fields["tokens"].text())
        self.model.accounts = [ACCOUNTS[1]]
        self.model.changed.emit()
        pump()
        self.assertIsNone(page.table.current_record())
        self.assertFalse(page.remove_button.isEnabled())
        self.assertFalse(dialog.refresh.isEnabled())
        dialog.close()
        pump()

    def test_persistent_history_pagination_filters_and_stale_responses(self):
        panel = self.window.page_widgets["activity"].persistent
        self.bridge.deferred.add("history:query")
        panel.account.setCurrentIndex(panel.account.findData("alpha"))
        panel.from_date.setText("2026-10-01")
        panel.to_date.setText("2026-10-14")
        panel.kind.setCurrentIndex(panel.kind.findData("skill-preset"))
        panel.load()
        older = self.bridge.held[-1]
        self.assertEqual(older[1][0]["accountId"], "alpha")
        self.assertEqual(older[1][0]["limit"], 100)
        self.assertEqual(older[1][0]["offset"], 0)
        self.assertTrue(older[1][0]["from"].endswith("Z"))
        panel.account.setCurrentIndex(panel.account.findData("beta"))
        panel.load()
        newest = self.bridge.held[-1]
        newest[2]({"rows": [{"id": "new", "accountId": "beta", "result": "confirmed", "values": {"observedTokens": 100}}], "total": 250})
        older[2]({"rows": [{"id": "old", "accountId": "alpha"}], "total": 1})
        self.assertEqual(panel.table.records[0]["id"], "new")
        self.assertTrue(panel.next.isEnabled())
        panel.next.click()
        request = self.bridge.held[-1]
        self.assertEqual(request[1][0]["offset"], 100)
        request[2]({"rows": [], "total": 250})
        self.assertTrue(panel.previous.isEnabled())
        saved = json.loads(QSettings().value("history/filters"))
        self.assertEqual(saved["accountId"], "beta")
        self.assertEqual(saved["from"], "2026-10-01")
        before = len(self.bridge.calls)
        panel.from_date.setText("2026-11-01")
        panel.load()
        self.assertEqual(len(self.bridge.calls), before)

    def test_claim_all_native_button_uses_scope_and_stops_on_account_change(self):
        page = self.window.page_widgets["rewards"]
        self.select_account(page)
        panel = page.batch
        self.assertTrue(panel.claim_all.isEnabled())
        self.bridge.deferred.add("progression-batch:discover")
        panel.claim_all.click()
        pump()
        request = next(request for request in self.bridge.held if request[0] == "progression-batch:discover")
        self.assertEqual(request[1][0]["accountIds"], ["alpha"])
        self.assertTrue(self.model.claim_busy)
        self.assertFalse(panel.claim_all.isEnabled())
        self.assertTrue(panel.stop.isEnabled())
        self.select_account(page, "beta")
        request[2]([{"accountId": "alpha", "kind": "reward", "payload": {"id": 1}, "eligible": True}])
        pump()
        self.assertFalse(self.model.claim_busy)
        self.assertFalse(any(channel == "progression-batch:prepare" for channel, _ in self.bridge.calls))

    def test_manual_reward_batch_respects_checked_actions_and_selected_scope(self):
        page = self.window.page_widgets["rewards"]
        self.model.select({"alpha", "beta"})
        panel = page.batch
        panel.scope.setCurrentIndex(panel.scope.findData("selected"))
        self.bridge.responses["progression-batch:discover"] = [{"accountId": "alpha", "label": "Principal", "kind": "reward", "payload": {"id": 1}, "eligible": True}, {"accountId": "beta", "label": "Storage", "kind": "mission", "payload": {"id": "day"}, "eligible": True}]
        self.bridge.responses["progression-batch:prepare"] = {"batchId": "batch-1", "phase": "review", "rows": []}
        panel.scan.click()
        pump()
        self.assertEqual(self.bridge.calls[-1][1][0]["accountIds"], ["alpha", "beta"])
        panel.table.item(1, 0).setCheckState(Qt.Unchecked)
        panel.review.click()
        pump()
        payload = next(args for channel, args in reversed(self.bridge.calls) if channel == "progression-batch:prepare")
        self.assertEqual(payload[0]["actions"], [{"accountId": "alpha", "kind": "reward", "payload": {"id": 1}}])

    def test_all_thirteen_pages_are_native_and_navigable(self):
        expected = {"overview", "accounts", "automation", "opening", "converter", "inventory", "games", "rewards", "skills", "autoopen", "diagnostics", "settings", "activity"}
        self.assertEqual(set(self.window.page_ids), expected)
        from PySide6.QtWebEngineWidgets import QWebEngineView
        self.assertEqual(self.window.findChildren(QWebEngineView), [])
        for identifier in expected:
            self.window.navigate(identifier)
            pump()
            self.assertEqual(self.window.pages.currentWidget(), self.window.page_widgets[identifier])

    def test_appearance_switch_preserves_selection_and_supports_rtl(self):
        self.model.select({"alpha"})
        self.window.navigate("settings")
        page = self.window.page_widgets["settings"]
        original_calls = len(self.bridge.calls)
        page.theme.setCurrentIndex(page.theme.findData("light"))
        page.rtl.setChecked(False)
        pump()
        self.assertEqual(app.palette().color(QPalette.Window).name(), "#ffffff")
        self.assertEqual(app.layoutDirection(), Qt.LeftToRight)
        self.assertEqual(self.model.selected, {"alpha"})
        self.assertEqual(len(self.bridge.calls), original_calls)
        self.assertEqual(QSettings().value("appearance/theme"), "light")
        self.assertFalse(QSettings().value("appearance/rtl", type=bool))
        self.assertIn("Inter", app.font().family())
        for index in range(self.window.navigation.count()):
            self.assertFalse(self.window.navigation.item(index).icon().isNull())
        for control in self.window.findChildren(QPushButton):
            self.assertEqual(control.cursor().shape(), Qt.PointingHandCursor)
        page.theme.setCurrentIndex(page.theme.findData("dark"))
        page.rtl.setChecked(True)
        pump()
        self.assertEqual(app.palette().color(QPalette.Window).name(), "#0c0a09")
        self.assertEqual(app.layoutDirection(), Qt.RightToLeft)

    def test_shared_account_selection_updates_from_native_checkboxes(self):
        page = self.window.page_widgets["accounts"]
        selection = page.selection
        selection.list.item(0).setCheckState(Qt.Checked)
        pump()
        self.assertEqual(self.model.selected, {"alpha"})
        self.assertTrue(self.window.page_widgets["automation"].start.isEnabled())
        selection.search.setText("Storage")
        selection.select_all()
        self.assertEqual(self.model.selected, {"alpha", "beta"})

    def test_reward_response_from_previous_account_is_discarded(self):
        page = self.window.page_widgets["rewards"]
        self.bridge.deferred.add("progression:rewards")
        self.select_account(page, "alpha")
        self.select_account(page, "beta")
        requests = [request for request in self.bridge.held if request[0] == "progression:rewards"]
        self.assertEqual(len(requests), 2)
        requests[1][2](self.bridge.response(requests[1][0], requests[1][1]))
        requests[0][2](self.bridge.response(requests[0][0], requests[0][1]))
        self.assertEqual(page.rewards.records[0]["title"], "beta · Cliques")

    def test_skill_map_and_presets_render_and_are_scoped(self):
        page = self.window.page_widgets["skills"]
        self.select_account(page)
        self.assertEqual(len(page.table.records), 2)
        self.assertGreater(len(page.scene.items()), 4)
        self.assertEqual(page.preset.count(), 2)
        page.maps.setCurrentText("Mirage")
        pump()
        self.assertEqual(page.data["map"]["name"], "Mirage")

    def test_inventory_selection_survives_pagination_with_correct_refs(self):
        page = self.window.page_widgets["inventory"]
        self.select_account(page)
        page.items.selectRow(0)
        pump()
        self.assertIn(ITEM_ID, page.chosen)
        self.assertEqual(page.chosen[ITEM_ID]["page"], 1)
        page.page.setValue(2)
        pump()
        page.items.selectRow(0)
        pump()
        self.assertEqual(len(page.chosen), 2)
        self.assertEqual(page.chosen["2" * 24]["page"], 2)
        self.select_account(page, "beta")
        self.assertEqual(page.chosen, {})

    def test_inventory_filters_use_contract_fields(self):
        page = self.window.page_widgets["inventory"]
        self.select_account(page)
        page.filters["favorites"].setCurrentIndex(page.filters["favorites"].findData("only"))
        page.filters["sort"].setCurrentIndex(page.filters["sort"].findData("float"))
        page.search.setText("AK-47")
        page.filter_changed()
        pump()
        call = next(args for channel, args in reversed(self.bridge.calls) if channel == "inventory:read")
        self.assertEqual(call[2]["favorites"], "only")
        self.assertEqual(call[2]["sort"], "float")
        self.assertEqual(call[2]["search"], "AK-47")

    def test_opening_rule_conditions_and_order_are_preserved(self):
        page = self.window.page_widgets["opening"]
        self.model.select(["alpha"])
        pump()
        page.cases.setCurrentIndex(page.cases.findData(CASE_ID))
        pump()
        rule = {"id": "specific", "name": "AK-47 | Case Hardened", "action": "keep", "conditions": {"floatMin": 0.01, "floatMax": 0.1, "patterns": ["661"], "statTrak": False, "topN": 10}}
        dialog = RuleDialog(self.model, page.rules.skins, rule, self.window)
        self.assertEqual(dialog.value(), rule)
        dialog.deleteLater()
        page.rules.save([rule, {"id": "general", "name": rule["name"], "action": "sell"}])
        page.rules.table.selectRow(1)
        page.rules.move(-1)
        self.assertEqual(page.rules.current_rules()[0]["id"], "general")
        page.open(False)
        pump()
        call = next(args for channel, args in reversed(self.bridge.calls) if channel == "open:start")
        self.assertEqual(call[0]["itemRules"][1]["conditions"]["topN"], 10)

    def test_settings_toggles_site_opening_without_changing_contract(self):
        page = self.window.page_widgets["settings"]
        page.site_opening.setChecked(False)
        pump()
        call = next(args for channel, args in reversed(self.bridge.calls) if channel == "preferences:update")
        self.assertEqual(call, [{"enableSiteOpening": False}])
        self.assertEqual(self.model.preferences, {"enableSiteOpening": False})

    def test_autoopen_review_uses_native_confirmation_and_exact_config(self):
        page = self.window.page_widgets["autoopen"]
        self.select_account(page)
        page.floats.setText("0.01, 0.5")
        page.patterns.setPlainText("661\n387")
        timer = QTimer()
        def confirm():
            dialog = QApplication.activeModalWidget()
            if isinstance(dialog, QDialog):
                for control in dialog.findChildren(QPushButton):
                    if control.text() == "Confirmar":
                        timer.stop()
                        QTest.mouseClick(control, Qt.LeftButton)
                        return
        timer.timeout.connect(confirm)
        timer.start(5)
        page.save_config()
        pump()
        timer.stop()
        call = next(args for channel, args in reversed(self.bridge.calls) if channel == "progression:prepare")
        self.assertEqual(call[0:2], ["alpha", "autoopen"])
        self.assertEqual(call[2]["config"]["customSelectedFloats"], [0.01, 0.5])
        self.assertEqual(call[2]["config"]["patternBlacklist"], ["661", "387"])
        self.assertIn(("progression:confirm", ["preview-1"]), self.bridge.calls)

    def test_invalid_autoopen_float_does_not_prepare_or_send(self):
        page = self.window.page_widgets["autoopen"]
        self.select_account(page)
        before = len(self.bridge.calls)
        page.floats.setText("nan")
        page.save_config()
        pump()
        self.assertFalse(any(channel in ("progression:prepare", "progression:confirm") for channel, _ in self.bridge.calls[before:]))

    def test_blackjack_move_controls_respect_turn_and_available_funds(self):
        page = self.window.page_widgets["games"]
        card = page.cards["alpha"]
        card.load()
        pump()
        event = {"type": "socket-game-update", "accountId": "alpha", "game": "blackjack", "event": "blackjackTableState", "data": {
            "tableId": "t", "phase": "acting", "roundNumber": 1, "dealerCards": [{"rank": "10", "suit": "S"}],
            "seats": [{"mine": True, "turnId": "turn-1", "activeHandIndex": 0, "bet": 10, "hands": [{"status": "playing", "bet": 10, "cards": [{"rank": "8", "suit": "H"}, {"rank": "8", "suit": "D"}]}]}]}}
        self.bridge.event.emit(event)
        controls = dict(card.buttons)
        self.assertTrue(controls["split"].isEnabled())
        card.state["tokens"] = 5
        card.update_controls()
        self.assertFalse(controls["double"].isEnabled())
        self.assertFalse(controls["split"].isEnabled())
        self.assertTrue(controls["stand"].isEnabled())
        self.bridge.event.emit({"type": "blackjack-qt", "accountId": "alpha", "state": {"active": True}})
        self.assertFalse(controls["stand"].isEnabled())

    def test_leaving_games_stops_auto_and_unavailable_ai_is_disabled(self):
        self.window.navigate("games")
        pump()
        page = self.window.page_widgets["games"]
        page.show_local_ai({"phase": "missing"})
        self.assertFalse(page.mode.model().item(page.mode.findData("laya")).isEnabled())
        self.window.navigate("overview")
        pump()
        self.assertIn(("blackjack:auto-stop", []), self.bridge.calls)


if __name__ == "__main__":
    unittest.main()
